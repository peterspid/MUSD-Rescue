/**
 * RescueGuard against the REAL Mezo MUSD protocol, forked from Mezo testnet.
 *   FORK=1 npx hardhat test test/fork/RescueGuard.fork.test.ts
 * Only the oracle precompile is replaced (Hardhat cannot run Mezo precompiles); BorrowerOperations,
 * BorrowerOperationsSignatures, TroveManager, SortedTroves, ActivePool and MUSD are the deployed contracts.
 */
import { expect } from "chai";
import { ethers, network } from "hardhat";

const MEZO = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  BorrowerOperationsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  MUSD: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  Oracle: "0x7b7c000000000000000000000000000000000015",
};
const E = ethers.parseEther;
const ZERO = ethers.ZeroAddress;

const boAbi = ["function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable"];
const tmAbi = [
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
];
const erc20 = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])",
];
const bosAbi = ["function getNonce(address) view returns (uint256)", "function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])"];

const REPAY_TYPES = { RepayMUSD: [{ name: "amount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const ADD_TYPES = { AddColl: [{ name: "assetAmount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
const PERMIT_TYPES = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };

(process.env.FORK === "1" ? describe : describe.skip)("RescueGuard on forked Mezo testnet (real MUSD protocol)", function () {
  this.timeout(900_000);

  async function setPrice(usd: number) {
    const stub = await ethers.getContractAt("StubAggregator", MEZO.Oracle);
    await (await stub.setPrice(BigInt(usd) * 10n ** 8n)).wait();
  }

  it("arms with permit + a real BorrowerOperationsSignatures authorization, refuses above trigger, rescues below it", async () => {
    const stubImpl = await (await ethers.getContractFactory("StubAggregator")).deploy();
    await network.provider.send("hardhat_setCode", [MEZO.Oracle, await ethers.provider.getCode(await stubImpl.getAddress())]);
    await setPrice(67_000);

    const [keeper] = await ethers.getSigners();
    const borrower = ethers.Wallet.createRandom().connect(ethers.provider);
    await network.provider.send("hardhat_setBalance", [borrower.address, "0x" + E("10").toString(16)]);

    const bo = new ethers.Contract(MEZO.BorrowerOperations, boAbi, borrower);
    const tm = new ethers.Contract(MEZO.TroveManager, tmAbi, ethers.provider);
    const musd = new ethers.Contract(MEZO.MUSD, erc20, ethers.provider);
    const bos = new ethers.Contract(MEZO.BorrowerOperationsSignatures, bosAbi, ethers.provider);

    // Open a real trove: 0.1 BTC against 2,500 MUSD (+fee +200 gas compensation) at $67k -> ICR ~248%.
    await (await bo.openTrove(E("2500"), ZERO, ZERO, { value: E("0.1"), gasLimit: 25_000_000 })).wait();
    expect((await tm.getEntireDebtAndColl(borrower.address)).coll).to.equal(E("0.1"));

    const guard = await (await ethers.getContractFactory("RescueGuard")).deploy(MEZO.BorrowerOperationsSignatures, MEZO.TroveManager, MEZO.PriceFeed, MEZO.MUSD);
    const gAddr = await guard.getAddress();

    // Sign exactly as the app does: domains read live from the contracts.
    const [, bName, bVer, bChain, bAddr] = await bos.eip712Domain();
    const bDomain = { name: bName, version: bVer, chainId: bChain, verifyingContract: bAddr };
    const nonce = await bos.getNonce(borrower.address);
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 30 * 86_400);
    const amount = E("300");
    const tip = E("3");
    const auth = await borrower.signTypedData(bDomain, REPAY_TYPES, { amount, borrower: borrower.address, nonce, deadline });
    const [, mName, mVer, mChain, mAddr] = await musd.eip712Domain();
    expect(mName).to.equal("Mezo USD");
    const pSig = ethers.Signature.from(
      await borrower.signTypedData({ name: mName, version: mVer, chainId: mChain, verifyingContract: mAddr }, PERMIT_TYPES, {
        owner: borrower.address,
        spender: gAddr,
        value: amount + tip,
        nonce: await musd.nonces(borrower.address),
        deadline,
      }),
    );
    const permit = { value: amount + tip, deadline, v: pSig.v, r: pSig.r, s: pSig.s };
    await (await guard.connect(borrower).armRepayWithPermit({ amount, keeperTip: tip, triggerIcr: E("2"), deadline }, auth, permit, { gasLimit: 1_000_000 })).wait();
    expect(await guard.musdReserve(borrower.address)).to.equal(amount + tip);

    // ICR ~248% > 200% trigger: nobody can run it.
    await expect(guard.connect(keeper).execute(borrower.address, ZERO, ZERO)).to.be.revertedWithCustomError(guard, "TriggerNotReached");

    // BTC falls to $50k -> ICR ~185% < 200%: any keeper can run it, and the MUSD is burned from the guard's reserve.
    await setPrice(50_000);
    expect((await guard.planStatus(borrower.address))[0]).to.equal(2n); // Ready
    const guardBal = await musd.balanceOf(gAddr);
    const keeperBal = await musd.balanceOf(keeper.address); // 0xf39F... is a public test key that holds MUSD on Mezo testnet
    const before = await tm.getEntireDebtAndColl(borrower.address);
    const rc = await (await guard.connect(keeper).execute(borrower.address, ZERO, ZERO, { gasLimit: 25_000_000 })).wait();
    const ev = rc!.logs
      .map((l) => {
        try {
          return guard.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x) => x?.name === "RescueExecuted")!;
    expect(ev.args.icrAfter).to.be.gt(ev.args.icrBefore);
    const after = await tm.getEntireDebtAndColl(borrower.address);
    expect(before.principal + before.interest - (after.principal + after.interest)).to.be.closeTo(amount, E("0.01"));
    // totalSupply is not a clean measure: the same tx mints accrued system interest to the PCV. The guard's own
    // balance is: exactly the rescue amount was burned and the tip paid out.
    expect(await musd.balanceOf(gAddr)).to.equal(guardBal - amount - tip);
    expect(await musd.balanceOf(keeper.address)).to.equal(keeperBal + tip);
    expect(await guard.musdReserve(borrower.address)).to.equal(0);
    expect(await bos.getNonce(borrower.address)).to.equal(nonce + 1n); // the real BOS consumed the nonce

    // A BTC top-up plan through the real addCollWithSignature.
    const n2 = await bos.getNonce(borrower.address);
    const add = E("0.02");
    const auth2 = await borrower.signTypedData(bDomain, ADD_TYPES, { assetAmount: add, borrower: borrower.address, nonce: n2, deadline });
    await (await guard.connect(borrower).armAddColl({ amount: add, keeperTip: 0, triggerIcr: E("2"), deadline }, auth2, { value: add, gasLimit: 1_000_000 })).wait();
    await setPrice(45_000);
    await (await guard.connect(keeper).execute(borrower.address, ZERO, ZERO, { gasLimit: 25_000_000 })).wait();
    expect((await tm.getEntireDebtAndColl(borrower.address)).coll).to.equal(E("0.12"));
    expect(await guard.btcReserve(borrower.address)).to.equal(0);
    expect(await guard.totalBtcReserves()).to.equal(0);
  });
});
