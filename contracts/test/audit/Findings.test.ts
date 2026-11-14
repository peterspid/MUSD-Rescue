import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type {
  RescueGuard,
  AuditBorrowerOperationsSignatures,
  AuditTroveManager,
  MockMUSD,
  MockPriceFeed,
} from "../../typechain-types";

// Audit PoCs. Every test asserts the SECURE behaviour, so it fails against the current RescueGuard and passes once the
// finding is fixed. Fixture mirrors test/RescueGuard.test.ts but uses mocks/audit/AuditMocks.sol, which model the real
// BorrowerOperations where the original mocks diverge (Recovery Mode, MUSD liquidation rule, real getters).

const E = (n: string | number) => ethers.parseEther(String(n));
const STATUS = { None: 0, Waiting: 1, Ready: 2, Expired: 3, StaleAuthorization: 4, Underfunded: 5, TroveNotActive: 6, OracleUnavailable: 7 } as const;
const ZERO = ethers.ZeroAddress;
const MCR = E("1.1");

// Same trove as the existing suite: 0.05 BTC against 2,300 MUSD at $60,000 -> ICR ~130.4%.
const PRICE = E(60_000);
const COLL = E("0.05");
const DEBT = E(2_300);

async function deploy() {
  const [deployer, alice, bob, keeper, mallory] = await ethers.getSigners();
  const musd = (await (await ethers.getContractFactory("MockMUSD")).deploy()) as unknown as MockMUSD;
  const pf = (await (await ethers.getContractFactory("MockPriceFeed")).deploy(PRICE)) as unknown as MockPriceFeed;
  const tm = (await (await ethers.getContractFactory("AuditTroveManager")).deploy(await pf.getAddress())) as unknown as AuditTroveManager;
  const bos = (await (await ethers.getContractFactory("AuditBorrowerOperationsSignatures")).deploy(
    await musd.getAddress(),
    await tm.getAddress(),
    await pf.getAddress(),
  )) as unknown as AuditBorrowerOperationsSignatures;
  await musd.setBurner(await bos.getAddress());
  await tm.setOperator(await bos.getAddress());
  const guard = (await (await ethers.getContractFactory("RescueGuard")).deploy(
    await bos.getAddress(),
    await tm.getAddress(),
    await pf.getAddress(),
    await musd.getAddress(),
  )) as unknown as RescueGuard;

  for (const u of [alice, bob]) {
    await tm.setTrove(u.address, COLL, DEBT, 1);
    await musd.mint(u.address, E(10_000));
  }
  await musd.mint(mallory.address, E(10_000));
  for (const u of [alice, bob, mallory]) await musd.connect(u).approve(await guard.getAddress(), ethers.MaxUint256);
  return { deployer, alice, bob, keeper, mallory, musd, pf, tm, bos, guard };
}

type Ctx = Awaited<ReturnType<typeof deploy>>;

async function signAuthorization(ctx: Ctx, signer: HardhatEthersSigner, kind: "Repay" | "AddColl", amount: bigint, deadline: bigint) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await ctx.bos.getNonce(signer.address);
  const domain = { name: "BorrowerOperationsSignatures", version: "1", chainId, verifyingContract: await ctx.bos.getAddress() };
  if (kind === "Repay") {
    const types = { RepayMUSD: [{ name: "amount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    return signer.signTypedData(domain, types, { amount, borrower: signer.address, nonce, deadline });
  }
  const types = { AddColl: [{ name: "assetAmount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  return signer.signTypedData(domain, types, { assetAmount: amount, borrower: signer.address, nonce, deadline });
}

async function deadlineIn(seconds: number) {
  return BigInt((await time.latest()) + seconds);
}

/** Sends a tx and reports whether it went through, without failing the test on revert. */
async function succeeds(p: Promise<unknown>) {
  try {
    const tx: any = await p;
    if (tx && typeof tx.wait === "function") await tx.wait();
    return true;
  } catch {
    return false;
  }
}

describe("RescueGuard audit findings", () => {
  // ---------------------------------------------------------------------------------------------------------------
  it("RG-01a: in Recovery Mode a repay that leaves ICR < MCR is executed, spending the reserve and tip on a trove that is still liquidatable", async () => {
    const ctx = await loadFixture(deploy);
    const { alice, keeper, mallory, guard, bos, tm, pf, musd } = ctx;

    // alice: repay 50 MUSD + 5 MUSD tip once ICR < 125%.
    const deadline = await deadlineIn(30 * 86_400);
    const sig = await signAuthorization(ctx, alice, "Repay", E(50), deadline);
    await guard.connect(alice).depositMUSD(E(55));
    await guard.connect(alice).armRepay({ amount: E(50), keeperTip: E(5), triggerIcr: E("1.25"), deadline }, sig);

    // Crash: system TCR < 150% (Recovery Mode) and alice's trove gapped to 106.5%, already under MCR.
    await bos.setRecoveryMode(true);
    const price = E(49_000);
    await pf.setPrice(price);
    expect(await tm.getCurrentICR(alice.address, price)).to.be.lt(MCR);

    // Real BorrowerOperations accepts a pure repayment at any resulting ICR in Recovery Mode (2450/2250 = 108.9%).
    await succeeds(guard.connect(keeper).execute(alice.address, ZERO, ZERO));

    // The trove is still below MCR, so the next liquidator takes everything (MUSD liquidations leave no surplus).
    if ((await tm.getCurrentICR(alice.address, price)) < MCR) await tm.connect(mallory).liquidate(alice.address);
    expect(await tm.getTroveStatus(alice.address)).to.equal(3);

    // Secure behaviour: a "rescue" that does not lift the trove to >= MCR must not consume alice's reserve or pay a tip.
    expect(await musd.balanceOf(keeper.address), "keeper was paid for a rescue that left the trove liquidatable").to.equal(0);
    expect(await guard.musdReserve(alice.address), "reserve burned into a trove that was liquidated anyway").to.equal(E(55));
  });

  // ---------------------------------------------------------------------------------------------------------------
  it("RG-01b: a keeper can liquidate the borrower inside the BTC-tip callback and execute() still succeeds (closed trove reads as infinite ICR)", async () => {
    const ctx = await loadFixture(deploy);
    const { alice, guard, bos, tm, pf } = ctx;

    const deadline = await deadlineIn(30 * 86_400);
    const amount = E("0.001");
    const tip = E("0.0001");
    const sig = await signAuthorization(ctx, alice, "AddColl", amount, deadline);
    await guard.connect(alice).armAddColl({ amount, keeperTip: tip, triggerIcr: E("1.25"), deadline }, sig, { value: amount + tip });

    await bos.setRecoveryMode(true);
    await pf.setPrice(E(49_000)); // ICR 106.5%; after +0.001 BTC: 2499/2300 = 108.65% (< MCR, accepted in Recovery Mode)

    const keeper = await (await ethers.getContractFactory("LiquidatingKeeper")).deploy(await guard.getAddress(), await tm.getAddress());

    // Inside execute(): BOS call -> tip sent -> keeper.receive() liquidates alice -> getCurrentICR(closed) == max
    // -> `icrAfter <= icrBefore` passes. Secure behaviour: the whole call reverts and the trove/reserve are untouched.
    const ok = await succeeds(keeper.run(alice.address));
    expect(ok, "execute() succeeded although the borrower was liquidated during the rescue").to.equal(false);
    expect(await tm.getTroveStatus(alice.address)).to.equal(1);
    expect(await guard.btcReserve(alice.address)).to.equal(amount + tip);
  });

  // ---------------------------------------------------------------------------------------------------------------
  it("RG-02: re-arming at the same BOS nonce leaves the replaced authorization live; a 10 MUSD replay kills a 250 MUSD plan", async () => {
    const ctx = await loadFixture(deploy);
    const { alice, mallory, guard, bos, pf } = ctx;
    await guard.connect(alice).depositMUSD(E(500));

    // First plan: a small 10 MUSD repay (e.g. a test plan, or the user later "edits" the amount). Nonce 0.
    const d1 = await deadlineIn(30 * 86_400);
    const s1 = await signAuthorization(ctx, alice, "Repay", E(10), d1);
    await guard.connect(alice).armRepay({ amount: E(10), keeperTip: 0, triggerIcr: E("1.25"), deadline: d1 }, s1);

    // alice replaces it with the plan she actually relies on. Still nonce 0, so s1 is still a valid BOS authorization.
    const d2 = await deadlineIn(30 * 86_400 + 1);
    const s2 = await signAuthorization(ctx, alice, "Repay", E(250), d2);
    const reArmed = await succeeds(
      guard.connect(alice).armRepay({ amount: E(250), keeperTip: E(10), triggerIcr: E("1.25"), deadline: d2 }, s2),
    );

    if (reArmed) {
      // mallory (a liquidator) replays the replaced, public s1 directly at BOS: pays 10 MUSD, burns alice's nonce.
      await bos.connect(mallory).repayMUSDWithSignature(E(10), ZERO, ZERO, alice.address, s1, d1);
      await pf.setPrice(E(54_000)); // ICR 117.9% < 125%: the 250 MUSD plan should fire now (-> 132%)
      await expect(guard.execute(alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(guard, "StaleAuthorization");
      // ... and at $50,000 (ICR 109.2%) alice is liquidated, earning mallory 200 MUSD gas comp + 0.5% coll for 10 MUSD.
      const [status] = await guard.planStatus(alice.address);
      expect(status, "armed plan was invalidated by replaying the authorization it replaced").to.equal(STATUS.Ready);
    }
    // Secure behaviour: RescueGuard refuses to hold a new authorization at a nonce for which it already accepted a
    // different one (the borrower must rotate the BOS nonce first), so the state above cannot be reached.
  });

  // ---------------------------------------------------------------------------------------------------------------
  it("RG-03: a repay plan BorrowerOperations can never accept (minNetDebt) is armed and reported Ready", async () => {
    const ctx = await loadFixture(deploy);
    const { alice, guard, pf } = ctx;
    await guard.connect(alice).depositMUSD(E(400));

    // Debt 2,300 -> net debt 2,100; repaying 400 would leave 1,700 < minNetDebt 1,800 (live testnet value).
    const deadline = await deadlineIn(30 * 86_400);
    const sig = await signAuthorization(ctx, alice, "Repay", E(400), deadline);
    const armed = await succeeds(guard.connect(alice).armRepay({ amount: E(400), keeperTip: 0, triggerIcr: E("1.25"), deadline }, sig));

    if (armed) {
      await pf.setPrice(E(55_000)); // ICR 119.6% < trigger
      const [status] = await guard.planStatus(alice.address);
      await expect(guard.execute(alice.address, ZERO, ZERO)).to.be.revertedWith("BorrowerOps: Trove's net debt must be greater than minimum");
      // Secure behaviour: such a plan is rejected at arm time, or at least never reported as Ready to UIs/keepers.
      expect(status, "planStatus says Ready but every execute() reverts in BorrowerOperations").to.not.equal(STATUS.Ready);
    }
  });
});
