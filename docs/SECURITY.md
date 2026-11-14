# Security: RescueGuard

RescueGuard (`contracts/contracts/RescueGuard.sol`) is the only contract MUSD Rescue deploys. It holds borrower reserves and executes rescues through Mezo's own `BorrowerOperationsSignatures`. This document covers the audit, every finding, how each was fixed and tested, and what a contract cannot prevent.

| | |
|---|---|
| Contract | [`0xf100dd7ae2d9dc651e9c9545790aa9c7b5a0e711`](https://explorer.test.mezo.org/address/0xf100dd7ae2d9dc651e9c9545790aa9c7b5a0e711#code) on Mezo testnet (chain 31611), source verified |
| Compiler | solc 0.8.24, optimizer 200 runs, `evmVersion: london`, OpenZeppelin 5.0.2 |
| Privileges | None. No owner, no admin, no pause, no upgrade path, no fee |
| Tests | 48 unit and regression tests (`npm run contracts:test`), 1 fork test against the real protocol (`npm run contracts:test:fork`), 19-check browser e2e on testnet |

## What the contract does

1. A borrower deposits a reserve: MUSD (pulled with an EIP-2612 `permit`, so there is no separate approve) or BTC.
2. The borrower stores a plan: a `RepayMUSD` or `AddColl` authorization signed for Mezo's `BorrowerOperationsSignatures` (BOS), a trigger collateral ratio, an amount, an optional keeper tip and a deadline. The signature is verified on-chain when the plan is stored.
3. Anyone may call `execute(borrower, hints)`. It reads the trove's ICR at the MUSD oracle price and continues only while the ICR is below the trigger. It then calls BOS, which burns the MUSD from RescueGuard (the caller) or receives the BTC, and adjusts the borrower's trove.

Funds can leave RescueGuard in only three ways: back to their owner (`withdrawMUSD`, `withdrawBTC`, `exit`), into the owner's own trove as an authorized rescue, or as the owner-chosen tip (capped at 10% of the rescue) to whoever executed it.

## Audit method

- Line-by-line review of every function, state transition and money path, by the author and by an independent reviewer who saw only the code and the MUSD sources (not the author's reasoning).
- The real protocol was read, not assumed: `BorrowerOperationsSignatures`, `BorrowerOperations`, `TroveManager`, `PriceFeed` and `MUSD` from [mezo-org/musd](https://github.com/mezo-org/musd). Live parameters were confirmed over RPC: the EIP-712 domain, minNetDebt = 1,800 MUSD, gas compensation = 200 MUSD, and TCR.
- Each finding got a failing proof-of-concept test first (`contracts/test/audit/Findings.test.ts`, committed before the fix in `20c0ab6`). The fix came in `3fd8b91`, and the PoC stays as a regression test.
- A fork test runs RescueGuard against the deployed MUSD contracts forked from Mezo testnet. It opens a real trove, arms with a real permit and BOS signature, then executes repay and top-up rescues. Only the oracle precompile is stubbed, because Hardhat cannot run Mezo precompiles.

## Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| RG-01 | Medium | A rescue that leaves the trove liquidatable is executed in Recovery Mode | Fixed |
| RG-02 | Low | A replaced authorization at the same nonce stays live and can disable the new plan | Fixed |
| RG-03 | Low | A repay plan that BorrowerOperations can never accept is armed and reported `Ready` | Fixed |

### RG-01 (Medium): rescue that leaves the trove liquidatable is executed in Recovery Mode

**Problem.** In Normal Mode, BorrowerOperations requires every adjustment to leave ICR ≥ 110% (MCR). In Recovery Mode (TCR < 150%) it does not: `_requireValidAdjustmentInRecoveryMode` accepts a pure repayment or top-up at any resulting ICR. MUSD still liquidates any trove below MCR, also in Recovery Mode, and takes the whole trove. The only post-condition was `icrAfter > icrBefore`, and it ran after the keeper tip had been paid.

**Scenario.** A trove holds 0.05 BTC against 2,300 MUSD, with a plan to repay 50 MUSD plus a 5 MUSD tip at a 125% trigger. BTC gaps to $49k, so ICR is 106.5% and the system is in Recovery Mode. A keeper calls `execute`, and BorrowerOperations accepts it, leaving the trove at 108.9%. The keeper is paid and the reserve is gone, but the trove is still liquidatable, and a liquidator can bundle `execute` and `liquidate`. In a variant using a BTC tip, a keeper contract liquidated the borrower from inside its `receive()` hook. A closed trove reads as infinite ICR, so the old post-condition passed.

**Fix.** The post-conditions now run before any tip is paid. They require that the trove is still active, the ICR improved, and the ICR is ≥ MCR, read live from BorrowerOperations. Otherwise the whole call reverts with `RescueLeavesTroveLiquidatable` and the reserve is untouched. Normal Mode behaviour is unchanged.

**Tests.** `RG-01a` (Recovery Mode repay under MCR) and `RG-01b` (liquidation inside the BTC-tip callback).

### RG-02 (Low): replaced authorization at the same nonce stays live

**Problem.** Replacing a plan, or disarming and re-arming, does not consume the BOS nonce. The replaced signature therefore stays valid at BOS until its deadline, and it is public because it was in calldata and storage.

**Scenario.** Alice arms a 10 MUSD repay at nonce 0, then replaces it with a 250 MUSD plan, still at nonce 0. Mallory submits the old 10 MUSD signature directly to BOS and pays the 10 MUSD herself. That burns Alice's nonce, so the 250 MUSD plan is now stale and will not run. When the price falls, Mallory liquidates Alice and earns the gas compensation and collateral bonus for a 10 MUSD outlay.

**Fix.** RescueGuard records the last authorization it accepted per borrower (nonce, deadline, signature hash), and the record persists across disarm and execute. A different signature for a nonce whose earlier authorization is still live is refused with `OutstandingAuthorization`. Re-arming the identical signature, for example to change only the trigger or tip, still works, and so does arming after the old deadline has passed. `outstandingAuthorization(borrower)` exposes the state. The app handles the extra step for the user: before storing a different plan it retires the old authorization with a signed 1-wei collateral top-up through BOS, which moves the nonce on. This flow ran on testnet in the browser e2e.

**Tests.** `RG-02`, plus "refuses a different authorization while the previous one is still live", "accepts a new authorization once the nonce has moved on", "…once the previous one has expired" and "re-arms the same authorization with a new trigger or tip".

### RG-03 (Low): repay plan that can never execute is reported Ready

**Problem.** A repayment must leave net debt at or above minNetDebt (debt − 200 − amount ≥ 1,800). Arming checked only the reserve, so a plan that BorrowerOperations would always reject could be stored, and `planStatus` reported it as `Ready`. Keepers that simulate first would skip it, and the borrower would believe they were protected.

**Fix.** Arming a repay plan now requires debt ≥ gas compensation + minNetDebt + amount, with both parameters read live from BorrowerOperations and debt from `getEntireDebtAndColl`. Otherwise it reverts with `PlanBelowMinNetDebt`. If debt later falls (the borrower repays) or governance raises minNetDebt, `planStatus` returns a new `Unexecutable` status, and the UI tells the borrower to arm a smaller repayment or a BTC top-up.

**Tests.** `RG-03`, "refuses a repay plan that would break minimum net debt" and "reports a repay plan that became infeasible as Unexecutable, and rolls back if the protocol rejects it".

### Found during the browser e2e (application, not contract)

The guard registry API could list the same on-chain rescue twice when two requests scanned the same block range concurrently. Scans are now serialized per server instance and logs are deduplicated by transaction hash and log index (`9717d7a`).

## Checked and found safe

- **Signature digest.** `abi.encode(typehash, amount, borrower, nonce, deadline)` is byte-identical to BOS's `encodePacked(typehash, abi.encode(data), nonce, deadline)`. The domain is read live from BOS. Kind, amount, nonce, deadline and borrower (= `msg.sender`) are all bound. OZ ECDSA accepts only 65-byte low-s signatures, the same set BOS accepts. A unit test in the app cross-checks the digest against a reimplementation of the contract's hashing.
- **Who pays.** BOS burns from its caller (RescueGuard), and exactly the authorized amount. `execute` checks its own balance delta equals the amount (`UnexpectedBurn`), so an upgraded protocol that changed the payer would be caught. This was confirmed on the forked real protocol.
- **Accounting.** The reserve is debited by amount plus tip before any external call. The totals always equal the sum of user reserves and never exceed the contract's balances (checked by a randomized invariant test). Users are isolated from each other, and deposits are measured by balance delta.
- **Reentrancy.** Every state-changing entry point is `nonReentrant`, and withdrawals follow checks-effects-interactions. Tested: re-entry from the BTC tip and re-entrant double withdrawal both revert.
- **Permit front-running.** Handled with `try/catch`, and funds are only ever pulled from `msg.sender`.
- **Trigger and units.** ICR is 1e18-scaled, the same as `getCurrentICR`, which includes accrued interest and pending redistribution, exactly as BorrowerOperations sees it. The trigger is bounded to 112% to 400%.
- **Plan lifecycle.** The plan is deleted before external calls, so a second execution reverts. Expired and stale plans revert with explicit errors.

## What a contract cannot prevent

- **Keeper liveness.** RescueGuard makes a rescue permissionless, not automatic. Someone has to call `execute`: the app's keeper (daily cron plus on request, when a keeper key is configured on the server), anyone running `npm run keeper`, or any visitor pressing "Run rescue now". A crash faster than the next keeper check can still liquidate a trove.
- **Price gaps.** If BTC falls past the trigger and below 110% before execution, a rescue sized for the trigger may be too small. Since RG-01 it then reverts instead of wasting the reserve. The UI warns when a plan cannot save a trove that has already gapped under 110%.
- **Oracle trust.** The trigger uses the MUSD oracle, the same price used for liquidations. When it is more than 60 seconds old, `fetchPrice` reverts and every trove operation, including rescues, is blocked.
- **Mezo protocol trust.** BOS, BorrowerOperations and TroveManager are upgradeable by Mezo. BorrowerOperations is on MUSD's burn list and could in principle burn RescueGuard's pooled MUSD. `UnexpectedBurn` only guards the `execute` path.
- **Bearer authorizations.** A plan's BOS signature is public. Anyone can submit it directly to BOS, but the submitter then pays the borrower's debt from their own funds. The plan becomes stale, and the UI asks the borrower to sign again.
- **Shared nonce.** Any other BOS-signed operation by the borrower moves the nonce and invalidates the plan (shown as "Needs a new signature").
- **EOAs only.** BOS verifies signatures with ECDSA, so smart-contract wallets (ERC-1271) cannot sign plans.
- **Plans outlive troves.** Liquidation, redemption and a direct `closeTrove` do not move the nonce. If a borrower reopens a trove directly, an old unexpired plan applies to it again. The loss is bounded by the owner's own reserve and tip, and the UI offers "Withdraw everything" when no trove is open.
- **Stray BTC.** BTC sent through Mezo's BTC ERC-20 precompile arrives without running any code. It is not tracked and cannot be recovered, since there is no sweep function. Tracked reserves are unaffected.

## Reporting

This is testnet software. Please report security issues by opening a private advisory on the GitHub repository.
