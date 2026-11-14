import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { RescueGuard, MockBorrowerOperationsSignatures, MockMUSD, MockPriceFeed, MockTroveManager } from "../typechain-types";

const E = (n: string | number) => ethers.parseEther(String(n));
const KIND = { None: 0, Repay: 1, AddColl: 2 } as const;
const STATUS = { None: 0, Waiting: 1, Ready: 2, Expired: 3, StaleAuthorization: 4, Underfunded: 5, TroveNotActive: 6, OracleUnavailable: 7 } as const;
const ZERO = ethers.ZeroAddress;

// A trove at $60,000 BTC: 0.05 BTC (= $3,000) against 2,300 MUSD debt -> ICR ~130.4%.
const PRICE = E(60_000);
const COLL = E("0.05");
const DEBT = E(2_300);

async function deploy() {
  const [deployer, alice, bob, keeper, mallory] = await ethers.getSigners();
  const musd = (await (await ethers.getContractFactory("MockMUSD")).deploy()) as unknown as MockMUSD;
  const pf = (await (await ethers.getContractFactory("MockPriceFeed")).deploy(PRICE)) as unknown as MockPriceFeed;
  const tm = (await (await ethers.getContractFactory("MockTroveManager")).deploy()) as unknown as MockTroveManager;
  const bos = (await (await ethers.getContractFactory("MockBorrowerOperationsSignatures")).deploy(
    await musd.getAddress(),
    await tm.getAddress(),
    await pf.getAddress(),
  )) as unknown as MockBorrowerOperationsSignatures;
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
  return { deployer, alice, bob, keeper, mallory, musd, pf, tm, bos, guard };
}

type Ctx = Awaited<ReturnType<typeof deploy>>;

async function signAuthorization(
  ctx: Ctx,
  signer: HardhatEthersSigner,
  kind: "Repay" | "AddColl",
  amount: bigint,
  deadline: bigint,
  opts: { borrower?: string; nonce?: bigint; verifyingContract?: string } = {},
) {
  const { chainId } = await ethers.provider.getNetwork();
  const borrower = opts.borrower ?? signer.address;
  const nonce = opts.nonce ?? (await ctx.bos.getNonce(borrower));
  const domain = { name: "BorrowerOperationsSignatures", version: "1", chainId, verifyingContract: opts.verifyingContract ?? (await ctx.bos.getAddress()) };
  if (kind === "Repay") {
    const types = { RepayMUSD: [{ name: "amount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    return signer.signTypedData(domain, types, { amount, borrower, nonce, deadline });
  }
  const types = { AddColl: [{ name: "assetAmount", type: "uint256" }, { name: "borrower", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  return signer.signTypedData(domain, types, { assetAmount: amount, borrower, nonce, deadline });
}

async function signPermit(ctx: Ctx, owner: HardhatEthersSigner, value: bigint, deadline: bigint, spender?: string) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "Mezo USD", version: "1", chainId, verifyingContract: await ctx.musd.getAddress() };
  const types = { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  const sig = ethers.Signature.from(
    await owner.signTypedData(domain, types, { owner: owner.address, spender: spender ?? (await ctx.guard.getAddress()), value, nonce: await ctx.musd.nonces(owner.address), deadline }),
  );
  return { value, deadline, v: sig.v, r: sig.r, s: sig.s };
}

async function deadlineIn(seconds: number) {
  return BigInt((await time.latest()) + seconds);
}

/** alice arms a 100 MUSD repay plan, trigger 125%, 5 MUSD tip, funded with a 105 MUSD permit deposit, in one tx. */
async function armedRepay(ctx: Ctx, over: Partial<{ amount: bigint; tip: bigint; trigger: bigint; deposit: bigint }> = {}) {
  const amount = over.amount ?? E(100);
  const tip = over.tip ?? E(5);
  const trigger = over.trigger ?? E("1.25");
  const deadline = await deadlineIn(30 * 86_400);
  const sig = await signAuthorization(ctx, ctx.alice, "Repay", amount, deadline);
  const permit = await signPermit(ctx, ctx.alice, over.deposit ?? amount + tip, await deadlineIn(3_600));
  await ctx.guard.connect(ctx.alice).armRepayWithPermit({ amount, keeperTip: tip, triggerIcr: trigger, deadline }, sig, permit);
  return { amount, tip, trigger, deadline, sig };
}

describe("RescueGuard", () => {
  describe("deployment", () => {
    it("rejects zero addresses", async () => {
      const ctx = await loadFixture(deploy);
      const F = await ethers.getContractFactory("RescueGuard");
      const a = [await ctx.bos.getAddress(), await ctx.tm.getAddress(), await ctx.pf.getAddress(), await ctx.musd.getAddress()];
      for (let i = 0; i < 4; i++) {
        const args = [...a];
        args[i] = ZERO;
        await expect(F.deploy(args[0], args[1], args[2], args[3])).to.be.revertedWithCustomError(ctx.guard, "ZeroAddress");
      }
    });

    it("exposes the same typehashes as BorrowerOperationsSignatures", async () => {
      const { guard } = await loadFixture(deploy);
      expect(await guard.REPAY_MUSD_TYPEHASH()).to.equal(ethers.id("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)"));
      expect(await guard.ADD_COLL_TYPEHASH()).to.equal(ethers.id("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)"));
    });

    it("computes the same digest a wallet signs (live domain)", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(1000);
      const sig = await signAuthorization(ctx, ctx.alice, "Repay", E(1), deadline);
      const digest = await ctx.guard.authorizationDigest(KIND.Repay, ctx.alice.address, E(1), 0, deadline);
      expect(ethers.recoverAddress(digest, sig)).to.equal(ctx.alice.address);
      await expect(ctx.guard.authorizationDigest(KIND.None, ctx.alice.address, E(1), 0, deadline)).to.be.revertedWithCustomError(ctx.guard, "NoPlan");
    });
  });

  describe("reserves", () => {
    it("deposits MUSD with a prior approve", async () => {
      const ctx = await loadFixture(deploy);
      await ctx.musd.connect(ctx.alice).approve(await ctx.guard.getAddress(), E(50));
      await expect(ctx.guard.connect(ctx.alice).depositMUSD(E(50))).to.emit(ctx.guard, "Deposited").withArgs(ctx.alice.address, 0, E(50));
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(50));
      expect(await ctx.guard.totalMusdReserves()).to.equal(E(50));
    });

    it("deposits MUSD in one transaction with an EIP-2612 permit (no approve)", async () => {
      const ctx = await loadFixture(deploy);
      const permit = await signPermit(ctx, ctx.alice, E(75), await deadlineIn(600));
      await ctx.guard.connect(ctx.alice).depositMUSDWithPermit(permit);
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(75));
      expect(await ctx.musd.allowance(ctx.alice.address, await ctx.guard.getAddress())).to.equal(0);
    });

    it("still deposits when a front-runner submits the permit first", async () => {
      const ctx = await loadFixture(deploy);
      const permit = await signPermit(ctx, ctx.alice, E(75), await deadlineIn(600));
      await ctx.musd.connect(ctx.mallory).permit(ctx.alice.address, await ctx.guard.getAddress(), permit.value, permit.deadline, permit.v, permit.r, permit.s);
      await ctx.guard.connect(ctx.alice).depositMUSDWithPermit(permit);
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(75));
    });

    it("cannot use someone else's permit to move their MUSD into your reserve", async () => {
      const ctx = await loadFixture(deploy);
      const permit = await signPermit(ctx, ctx.alice, E(75), await deadlineIn(600));
      // permit is for owner=alice; mallory calling it pulls from mallory, who never approved -> revert.
      await expect(ctx.guard.connect(ctx.mallory).depositMUSDWithPermit(permit)).to.be.revertedWithCustomError(ctx.musd, "ERC20InsufficientAllowance");
      expect(await ctx.guard.musdReserve(ctx.mallory.address)).to.equal(0);
    });

    it("deposits and withdraws BTC", async () => {
      const ctx = await loadFixture(deploy);
      await ctx.guard.connect(ctx.alice).depositBTC({ value: E("0.01") });
      expect(await ctx.guard.btcReserve(ctx.alice.address)).to.equal(E("0.01"));
      await expect(ctx.guard.connect(ctx.alice).withdrawBTC(E("0.004"))).to.changeEtherBalances([ctx.alice, ctx.guard], [E("0.004"), -E("0.004")]);
      expect(await ctx.guard.totalBtcReserves()).to.equal(E("0.006"));
    });

    it("rejects zero deposits and over-withdrawals; never pays out another user's reserve", async () => {
      const ctx = await loadFixture(deploy);
      await expect(ctx.guard.connect(ctx.alice).depositBTC()).to.be.revertedWithCustomError(ctx.guard, "ZeroAmount");
      await expect(ctx.guard.connect(ctx.alice).depositMUSD(0)).to.be.revertedWithCustomError(ctx.guard, "ZeroAmount");
      await ctx.guard.connect(ctx.alice).depositBTC({ value: E("0.01") });
      await expect(ctx.guard.connect(ctx.mallory).withdrawBTC(E("0.01"))).to.be.revertedWithCustomError(ctx.guard, "InsufficientReserve");
      await expect(ctx.guard.connect(ctx.alice).withdrawBTC(E("0.02"))).to.be.revertedWithCustomError(ctx.guard, "InsufficientReserve");
      await expect(ctx.guard.connect(ctx.alice).withdrawMUSD(1)).to.be.revertedWithCustomError(ctx.guard, "InsufficientReserve");
    });

    it("refuses plain BTC transfers that would not be tracked", async () => {
      const ctx = await loadFixture(deploy);
      await expect(ctx.alice.sendTransaction({ to: await ctx.guard.getAddress(), value: 1n })).to.be.reverted;
    });

    it("blocks re-entrant double withdrawal", async () => {
      const ctx = await loadFixture(deploy);
      const att = await (await ethers.getContractFactory("ReentrantWithdrawer")).deploy(await ctx.guard.getAddress());
      await ctx.guard.connect(ctx.alice).depositBTC({ value: E("1") }); // victim liquidity in the contract
      await att.fund({ value: E("0.1") });
      await expect(att.drain(E("0.1"))).to.be.revertedWithCustomError(ctx.guard, "BTCTransferFailed");
      expect(await ctx.guard.btcReserve(await att.getAddress())).to.equal(E("0.1"));
      expect(await ethers.provider.getBalance(await ctx.guard.getAddress())).to.equal(E("1.1"));
    });
  });

  describe("arming", () => {
    it("deposits with permit and stores a repay plan in one transaction", async () => {
      const ctx = await loadFixture(deploy);
      const p = await armedRepay(ctx);
      const plan = await ctx.guard.getPlan(ctx.alice.address);
      expect(plan.kind).to.equal(KIND.Repay);
      expect(plan.amount).to.equal(p.amount);
      expect(plan.keeperTip).to.equal(p.tip);
      expect(plan.triggerIcr).to.equal(p.trigger);
      expect(plan.nonce).to.equal(0);
      expect(plan.signature).to.equal(p.sig);
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(105));
    });

    it("emits Armed with the signed nonce", async () => {
      const ctx = await loadFixture(deploy);
      await ctx.bos.burnNonce(ctx.alice.address); // nonce 1
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "Repay", E(10), deadline);
      await ctx.musd.connect(ctx.alice).approve(await ctx.guard.getAddress(), E(10));
      await ctx.guard.connect(ctx.alice).depositMUSD(E(10));
      await expect(ctx.guard.connect(ctx.alice).armRepay({ amount: E(10), keeperTip: 0, triggerIcr: E("1.3"), deadline }, sig))
        .to.emit(ctx.guard, "Armed")
        .withArgs(ctx.alice.address, KIND.Repay, E(10), 0, E("1.3"), deadline, 1);
    });

    it("stores a BTC top-up plan funded in the same transaction", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "AddColl", E("0.01"), deadline);
      await ctx.guard.connect(ctx.alice).armAddColl({ amount: E("0.01"), keeperTip: E("0.0005"), triggerIcr: E("1.25"), deadline }, sig, { value: E("0.0105") });
      expect((await ctx.guard.getPlan(ctx.alice.address)).kind).to.equal(KIND.AddColl);
      expect(await ctx.guard.btcReserve(ctx.alice.address)).to.equal(E("0.0105"));
    });

    it("validates every plan field", async () => {
      const ctx = await loadFixture(deploy);
      const g = ctx.guard.connect(ctx.alice);
      await ctx.musd.connect(ctx.alice).approve(await ctx.guard.getAddress(), E(1000));
      await g.depositMUSD(E(1000));
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline);
      const ok = { amount: E(100), keeperTip: E(5), triggerIcr: E("1.25"), deadline };
      await expect(g.armRepay({ ...ok, amount: 0 }, sig)).to.be.revertedWithCustomError(ctx.guard, "ZeroAmount");
      await expect(g.armRepay({ ...ok, triggerIcr: E("1.1") }, sig)).to.be.revertedWithCustomError(ctx.guard, "TriggerOutOfRange");
      await expect(g.armRepay({ ...ok, triggerIcr: E("1.119") }, sig)).to.be.revertedWithCustomError(ctx.guard, "TriggerOutOfRange");
      await expect(g.armRepay({ ...ok, triggerIcr: E("4.01") }, sig)).to.be.revertedWithCustomError(ctx.guard, "TriggerOutOfRange");
      await expect(g.armRepay({ ...ok, keeperTip: E("10.01") }, sig)).to.be.revertedWithCustomError(ctx.guard, "TipTooHigh");
      await expect(g.armRepay({ ...ok, deadline: BigInt(await time.latest()) }, sig)).to.be.revertedWithCustomError(ctx.guard, "DeadlineInPast");
      await expect(g.armRepay(ok, sig)).to.emit(ctx.guard, "Armed");
    });

    it("rejects an authorization not signed by the caller", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      await ctx.musd.connect(ctx.mallory).approve(await ctx.guard.getAddress(), E(200));
      await ctx.guard.connect(ctx.mallory).depositMUSD(E(200));
      await ctx.tm.setTrove(ctx.mallory.address, COLL, DEBT, 1);
      // alice's signature replayed by mallory for mallory's own address
      const aliceSig = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline);
      await expect(ctx.guard.connect(ctx.mallory).armRepay({ amount: E(100), keeperTip: 0, triggerIcr: E("1.3"), deadline }, aliceSig)).to.be.revertedWithCustomError(ctx.guard, "InvalidAuthorization");
    });

    it("rejects signatures for a different amount, kind, nonce, deadline or contract", async () => {
      const ctx = await loadFixture(deploy);
      const g = ctx.guard.connect(ctx.alice);
      await ctx.musd.connect(ctx.alice).approve(await ctx.guard.getAddress(), E(1000));
      await g.depositMUSD(E(1000));
      await g.depositBTC({ value: E(1) });
      const deadline = await deadlineIn(86_400);
      const p = { amount: E(100), keeperTip: 0, triggerIcr: E("1.3"), deadline };
      const wrongAmount = await signAuthorization(ctx, ctx.alice, "Repay", E(99), deadline);
      const wrongKind = await signAuthorization(ctx, ctx.alice, "AddColl", E(100), deadline);
      const wrongNonce = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline, { nonce: 7n });
      const wrongDeadline = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline + 1n);
      const wrongContract = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline, { verifyingContract: ctx.mallory.address });
      for (const sig of [wrongAmount, wrongKind, wrongNonce, wrongDeadline, wrongContract]) {
        await expect(g.armRepay(p, sig)).to.be.revertedWithCustomError(ctx.guard, "InvalidAuthorization");
      }
      const repaySig = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline);
      await expect(g.armAddColl(p, repaySig)).to.be.revertedWithCustomError(ctx.guard, "InvalidAuthorization");
    });

    it("rejects malformed signatures", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      await ctx.musd.connect(ctx.alice).approve(await ctx.guard.getAddress(), E(100));
      await ctx.guard.connect(ctx.alice).depositMUSD(E(100));
      await expect(ctx.guard.connect(ctx.alice).armRepay({ amount: E(100), keeperTip: 0, triggerIcr: E("1.3"), deadline }, "0x1234")).to.be.revertedWithCustomError(ctx.guard, "ECDSAInvalidSignatureLength");
    });

    it("rejects plans for a borrower without an active trove", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.keeper, "AddColl", E("0.01"), deadline);
      await expect(ctx.guard.connect(ctx.keeper).armAddColl({ amount: E("0.01"), keeperTip: 0, triggerIcr: E("1.3"), deadline }, sig, { value: E("0.01") })).to.be.revertedWithCustomError(ctx.guard, "TroveNotActive");
    });

    it("rejects an unfunded plan", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "Repay", E(100), deadline);
      await expect(ctx.guard.connect(ctx.alice).armRepay({ amount: E(100), keeperTip: E(1), triggerIcr: E("1.3"), deadline }, sig)).to.be.revertedWithCustomError(ctx.guard, "InsufficientReserve").withArgs(0, E(101));
    });

    it("replaces an existing plan when re-armed", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "Repay", E(50), deadline);
      await ctx.guard.connect(ctx.alice).armRepay({ amount: E(50), keeperTip: 0, triggerIcr: E("1.4"), deadline }, sig);
      const plan = await ctx.guard.getPlan(ctx.alice.address);
      expect(plan.amount).to.equal(E(50));
      expect(plan.triggerIcr).to.equal(E("1.4"));
    });
  });

  describe("execution", () => {
    it("refuses to act while the trove is above its trigger", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx, { trigger: E("1.25") }); // ICR is ~130.4%
      const icr = await ctx.tm.getCurrentICR(ctx.alice.address, PRICE);
      await expect(ctx.guard.connect(ctx.keeper).execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "TriggerNotReached").withArgs(icr, E("1.25"));
    });

    it("lets any keeper repay from the reserve once the price drops below the trigger", async () => {
      const ctx = await loadFixture(deploy);
      const p = await armedRepay(ctx);
      await ctx.pf.setPrice(E(57_000)); // ICR -> ~123.9% < 125%
      const before = await ctx.tm.getCurrentICR(ctx.alice.address, E(57_000));
      const supplyBefore = await ctx.musd.totalSupply();

      await expect(ctx.guard.connect(ctx.keeper).execute(ctx.alice.address, ZERO, ZERO))
        .to.emit(ctx.guard, "RescueExecuted")
        .withArgs(ctx.alice.address, ctx.keeper.address, KIND.Repay, p.amount, p.tip, before, (COLL * E(57_000)) / (DEBT - p.amount), E(57_000));

      const t = await ctx.tm.troves(ctx.alice.address);
      expect(t.debt).to.equal(DEBT - p.amount);
      expect(await ctx.musd.balanceOf(ctx.keeper.address)).to.equal(p.tip);
      expect(await ctx.musd.totalSupply()).to.equal(supplyBefore - p.amount); // burned, not transferred
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(0);
      expect(await ctx.guard.totalMusdReserves()).to.equal(0);
      expect((await ctx.guard.getPlan(ctx.alice.address)).kind).to.equal(KIND.None);
    });

    it("tops up collateral from the BTC reserve and pays the tip in BTC", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      const amount = E("0.01");
      const sig = await signAuthorization(ctx, ctx.alice, "AddColl", amount, deadline);
      await ctx.guard.connect(ctx.alice).armAddColl({ amount, keeperTip: E("0.0002"), triggerIcr: E("1.25"), deadline }, sig, { value: E("0.0102") });
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.connect(ctx.keeper).execute(ctx.alice.address, ZERO, ZERO)).to.changeEtherBalances(
        [ctx.guard, ctx.bos, ctx.keeper],
        [-E("0.0102"), amount, E("0.0002")],
      );
      expect((await ctx.tm.troves(ctx.alice.address)).coll).to.equal(COLL + amount);
      expect(await ctx.guard.btcReserve(ctx.alice.address)).to.equal(0);
    });

    it("lets the borrower execute their own plan", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx, { tip: 0n, deposit: E(100) });
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.connect(ctx.alice).execute(ctx.alice.address, ZERO, ZERO)).to.emit(ctx.guard, "RescueExecuted");
    });

    it("consumes the plan: a second execution reverts", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx, { deposit: E(500) });
      await ctx.pf.setPrice(E(50_000));
      await ctx.guard.connect(ctx.keeper).execute(ctx.alice.address, ZERO, ZERO);
      await expect(ctx.guard.connect(ctx.keeper).execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "NoPlan");
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(395)); // leftover stays withdrawable
    });

    it("reverts without a plan, after the deadline, or after the nonce was used elsewhere", async () => {
      const ctx = await loadFixture(deploy);
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "NoPlan");

      const p = await armedRepay(ctx);
      await ctx.pf.setPrice(E(57_000));
      const snapshot = await ethers.provider.send("evm_snapshot", []);
      await time.increaseTo(p.deadline + 1n);
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "AuthorizationExpired");
      await ethers.provider.send("evm_revert", [snapshot]);

      await ctx.bos.burnNonce(ctx.alice.address);
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "StaleAuthorization").withArgs(0, 1);
    });

    it("reverts if the borrower withdrew the reserve (withdrawal stays possible while armed)", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      await ctx.guard.connect(ctx.alice).withdrawMUSD(E(50));
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "InsufficientReserve").withArgs(E(55), E(105));
    });

    it("reverts if the trove was closed or liquidated", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      await ctx.tm.setTrove(ctx.alice.address, 0, 0, 3);
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "TroveNotActive");
    });

    it("reverts while the oracle is stale (the protocol would reject the rescue anyway)", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      await ctx.pf.setStale(true);
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWith("PriceFeed: Oracle is stale.");
    });

    it("rolls back completely when the protocol rejects the rescue (minNetDebt)", async () => {
      const ctx = await loadFixture(deploy);
      // 400 MUSD would leave net debt 2300-200-400 = 1700 < 1800
      await armedRepay(ctx, { amount: E(400), tip: 0n, deposit: E(400) });
      await ctx.pf.setPrice(E(55_000));
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWith("BorrowerOps: Trove's net debt must be greater than minimum");
      expect((await ctx.guard.getPlan(ctx.alice.address)).kind).to.equal(KIND.Repay);
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(400));
    });

    it("rolls back when the rescue is too small to clear MCR", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx, { amount: E(1), tip: 0n, deposit: E(1) });
      await ctx.pf.setPrice(E(50_000)); // ICR ~108.7%; repaying 1 MUSD leaves it under 110%
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWith("BorrowerOps: An operation that would result in ICR < MCR is not permitted");
    });

    it("never touches another borrower's reserve", async () => {
      const ctx = await loadFixture(deploy);
      const permit = await signPermit(ctx, ctx.bob, E(1_000), await deadlineIn(600));
      await ctx.guard.connect(ctx.bob).depositMUSDWithPermit(permit);
      await armedRepay(ctx);
      await ctx.pf.setPrice(E(57_000));
      await ctx.guard.execute(ctx.alice.address, ZERO, ZERO);
      expect(await ctx.guard.musdReserve(ctx.bob.address)).to.equal(E(1_000));
      expect(await ctx.musd.balanceOf(await ctx.guard.getAddress())).to.equal(E(1_000));
      expect((await ctx.tm.troves(ctx.bob.address)).debt).to.equal(DEBT);
    });

    it("guards against a protocol that burns more than authorized", async () => {
      const ctx = await loadFixture(deploy);
      const permit = await signPermit(ctx, ctx.bob, E(1_000), await deadlineIn(600));
      await ctx.guard.connect(ctx.bob).depositMUSDWithPermit(permit); // liquidity a bad burn could steal
      await armedRepay(ctx);
      await ctx.bos.setExtraBurn(E(500));
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "UnexpectedBurn").withArgs(E(100), E(600));
    });

    it("guards against a call that does not improve the trove", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      await ctx.bos.setSkipStateUpdate(true);
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "RescueDidNotImprove");
    });

    it("blocks a keeper that re-enters from its BTC tip", async () => {
      const ctx = await loadFixture(deploy);
      const deadline = await deadlineIn(86_400);
      const sig = await signAuthorization(ctx, ctx.alice, "AddColl", E("0.01"), deadline);
      await ctx.guard.connect(ctx.alice).armAddColl({ amount: E("0.01"), keeperTip: E("0.001"), triggerIcr: E("1.25"), deadline }, sig, { value: E("0.011") });
      await ctx.pf.setPrice(E(57_000));
      const att = await (await ethers.getContractFactory("ReentrantKeeper")).deploy(await ctx.guard.getAddress());
      await expect(att.run(ctx.alice.address)).to.be.revertedWithCustomError(ctx.guard, "BTCTransferFailed");
      expect((await ctx.guard.getPlan(ctx.alice.address)).kind).to.equal(KIND.AddColl); // nothing happened
    });

    it("disarm stops execution; exit returns every unit deposited", async () => {
      const ctx = await loadFixture(deploy);
      await armedRepay(ctx);
      await ctx.guard.connect(ctx.alice).depositBTC({ value: E("0.02") });
      await expect(ctx.guard.connect(ctx.alice).disarm()).to.emit(ctx.guard, "Disarmed").withArgs(ctx.alice.address);
      await ctx.pf.setPrice(E(57_000));
      await expect(ctx.guard.execute(ctx.alice.address, ZERO, ZERO)).to.be.revertedWithCustomError(ctx.guard, "NoPlan");

      const musdBefore = await ctx.musd.balanceOf(ctx.alice.address);
      await expect(ctx.guard.connect(ctx.alice).exit()).to.changeEtherBalance(ctx.alice, E("0.02"));
      expect(await ctx.musd.balanceOf(ctx.alice.address)).to.equal(musdBefore + E(105));
      expect(await ctx.guard.totalMusdReserves()).to.equal(0);
      expect(await ctx.guard.totalBtcReserves()).to.equal(0);
    });

    it("a third party submitting the public authorization directly only pays the borrower's debt for them", async () => {
      const ctx = await loadFixture(deploy);
      const p = await armedRepay(ctx);
      const plan = await ctx.guard.getPlan(ctx.alice.address);
      await ctx.bos.connect(ctx.mallory).repayMUSDWithSignature(p.amount, ZERO, ZERO, ctx.alice.address, plan.signature, plan.deadline);
      expect(await ctx.musd.balanceOf(ctx.mallory.address)).to.equal(E(10_000) - p.amount); // mallory paid
      expect(await ctx.guard.musdReserve(ctx.alice.address)).to.equal(E(105)); // alice's reserve untouched
      const [status] = await ctx.guard.planStatus(ctx.alice.address);
      expect(status).to.equal(STATUS.StaleAuthorization); // UI asks alice to re-sign
    });
  });

  describe("planStatus", () => {
    it("reports every state a UI needs to explain", async () => {
      const ctx = await loadFixture(deploy);
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.None);
      const p = await armedRepay(ctx);
      const [waiting, icr, price] = await ctx.guard.planStatus(ctx.alice.address);
      expect(waiting).to.equal(STATUS.Waiting);
      expect(price).to.equal(PRICE);
      expect(icr).to.equal((COLL * PRICE) / DEBT);

      await ctx.pf.setPrice(E(57_000));
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.Ready);

      await ctx.guard.connect(ctx.alice).withdrawMUSD(E(1));
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.Underfunded);

      await ctx.pf.setStale(true);
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.OracleUnavailable);
      await ctx.pf.setStale(false);

      await ctx.bos.burnNonce(ctx.alice.address);
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.StaleAuthorization);

      await time.increaseTo(p.deadline + 1n);
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.Expired);

      await ctx.tm.setTrove(ctx.alice.address, 0, 0, 2);
      expect((await ctx.guard.planStatus(ctx.alice.address))[0]).to.equal(STATUS.TroveNotActive);
    });
  });

  describe("invariants", () => {
    it("tracked reserves always equal the sum of user reserves and never exceed balances", async () => {
      const ctx = await loadFixture(deploy);
      const users = [ctx.alice, ctx.bob, ctx.mallory];
      const guardAddr = await ctx.guard.getAddress();
      for (const u of users) await ctx.musd.connect(u).approve(guardAddr, ethers.MaxUint256);
      let seed = 42;
      const rnd = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed % n;
      };
      for (let i = 0; i < 60; i++) {
        const u = users[rnd(3)];
        const g = ctx.guard.connect(u);
        const op = rnd(4);
        const amt = E(rnd(50) + 1) / 1000n;
        if (op === 0) await g.depositMUSD(amt);
        else if (op === 1) await g.depositBTC({ value: amt });
        else if (op === 2) {
          const r = await ctx.guard.musdReserve(u.address);
          if (r > 0n) await g.withdrawMUSD(r / 2n + 1n > r ? r : r / 2n + 1n);
        } else {
          const r = await ctx.guard.btcReserve(u.address);
          if (r > 0n) await g.withdrawBTC(r);
        }
        let sumM = 0n, sumB = 0n;
        for (const x of users) {
          sumM += await ctx.guard.musdReserve(x.address);
          sumB += await ctx.guard.btcReserve(x.address);
        }
        expect(await ctx.guard.totalMusdReserves()).to.equal(sumM);
        expect(await ctx.guard.totalBtcReserves()).to.equal(sumB);
        expect(await ctx.musd.balanceOf(guardAddr)).to.be.gte(sumM);
        expect(await ethers.provider.getBalance(guardAddr)).to.be.gte(sumB);
      }
    });
  });
});
