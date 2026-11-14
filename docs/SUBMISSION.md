# AKINDO WaveHack submission: MUSD Rescue (Wave 2)

Ready-to-paste answers. Team details are left for the team to fill in.

## Project name
MUSD Rescue

## One-line description
See how far BTC can fall before your MUSD trove is liquidated, then store a rescue on-chain that runs by itself when it is needed.

## Links
- Live app: https://musd-rescue.vercel.app (Mezo testnet)
- GitHub: https://github.com/peterspid/MUSD-Rescue
- RescueGuard contract (verified): https://explorer.test.mezo.org/address/0xf100dd7ae2d9dc651e9c9545790aa9c7b5a0e711#code
- Security write-up: https://github.com/peterspid/MUSD-Rescue/blob/main/docs/SECURITY.md

## Problem
An MUSD trove is liquidated the moment its collateral ratio falls below 110%, and the liquidator takes the whole trove. Borrowers need to know how far BTC can fall, how much MUSD to repay or BTC to add, and whether the contract will accept it, because a repayment can be rejected by the 1,800 MUSD minimum net debt. Then they need to act in time. Liquidations happen when people are asleep, travelling or simply not watching.

## Solution
MUSD Rescue reads every MUSD trove directly from the protocol contracts on Mezo and shows the price that would liquidate it. It simulates repayments and collateral top-ups against the contract's own rules and prepares the exact transaction BorrowerOperations will accept, then verifies the receipt on-chain.

In Wave 2 we added **RescueGuard**, an audited contract that makes the rescue happen without the borrower online. The borrower deposits an MUSD reserve with an EIP-2612 permit and signs a repayment authorization for Mezo's own BorrowerOperationsSignatures contract. Anyone can then call `execute()`, but it only goes through while the trove's collateral ratio at the MUSD oracle price is below the borrower's trigger, and only if the rescue lifts the trove back above 110%. Keepers can earn a tip the owner sets. The contract has no owner, no admin and no fees.

## How it uses Mezo and MUSD
- MUSD is the core of the product. It reads TroveManager, BorrowerOperations, PriceFeed, SortedTroves and HintHelpers through Multicall3, and mirrors every MUSD rule exactly: 110% MCR, Recovery Mode at 150% TCR, minimum net debt, gas compensation, interest-first repayment, NICR list hints and oracle staleness.
- Rescues run through MUSD's own `BorrowerOperationsSignatures` (EIP-712). On a signed repayment, MUSD burns from the caller, which lets RescueGuard repay from a reserve without ever taking custody of the trove.
- MUSD's EIP-2612 `permit` makes funding a reserve a single transaction with no approve.
- In-app BTC to MUSD swaps go through Mezo Pools, so a borrower can get the MUSD to repay without leaving the app.
- Testnet onboarding goes from faucet BTC to an open trove (BorrowerOperations `openTrove`) to a protected trove, all in the app.

## What we built in this wave
1. **RescueGuard contract** (Solidity 0.8.24, OZ 5.0.2), deployed and source-verified on Mezo testnet.
2. **Independent security audit.** It found 1 Medium and 2 Low issues: a Recovery Mode rescue that left the trove liquidatable, a replayable replaced authorization, and an unexecutable plan shown as Ready. Each got a failing proof-of-concept, a fix and a regression test, plus a fork test against the real MUSD protocol. 48 contract tests in total.
3. **Guard page**: set up, change, cancel and withdraw plans, status and run-now for anyone, and a public registry of protected troves and rescues run on-chain.
4. **Keepers**: a server keeper (daily cron and on request) and an open-source `npm run keeper` that anyone can run.
5. **Mezo Pools swap** and **in-app trove opening** for faster onboarding.
6. **Full redesign** in blue, black and white. Risk is shown by ink density and the liquidation zone is always hatched. Responsive from 360 px phones.
7. **Browser end-to-end test on testnet** with four real wallets and real transactions: 19/19 checks, every transaction confirmed on the explorer. One example: a third-party wallet ran a guarded rescue that repaid 90 MUSD and lifted the ratio from 148.5% to 155.2%.

## Tech stack
Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, wagmi 2 + viem 2, TanStack Query, Radix, Recharts, Neon Postgres, Vercel (functions, cron, analytics), Solidity 0.8.24 + OpenZeppelin 5.0.2 + Hardhat, Vitest, Playwright.

## Proof it works (Mezo testnet)
- RescueGuard deployment: https://explorer.test.mezo.org/tx/0xa9224eb8d6af78f5e8d39ec20ab6004ddfc12f445509166dc52b643c4eb56072
- Plan stored with authorization + permit in one tx: https://explorer.test.mezo.org/tx/0x2d43c381a44c76444bfa530ad0215eaa6935988fe14d11777d321f1fb4d8a4d3
- Rescue run by a third party (−90 MUSD debt): https://explorer.test.mezo.org/tx/0xab574e6bf2b782928e0d8b18eec224fef8982ac07cd6d17af4d807439a3452c1
- Mezo Pools swap: https://explorer.test.mezo.org/tx/0x5b83926b5d7ae7c76611916ffb35de2725c435132f255a137ad683a9624d0aba
- Trove opened in the app: https://explorer.test.mezo.org/tx/0x38a7a3ca60059cb544f7a71d5b075fc00880656181cd6d71bdb18ef49115914f
- Full list: `deployments/e2e-wave2.json` in the repository

## What's next
Multi-step plans (several pre-signed rescues), a keeper network with tip markets, push and email alerts, Stability-Pool-aware liquidation previews, and RescueGuard on mainnet after an external audit.

## Team
_To be filled in by the team._
