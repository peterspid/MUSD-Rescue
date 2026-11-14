# MUSD Rescue

**See liquidation risk early. Understand your options. Act with confidence.**

**Live app: https://musd-rescue.vercel.app** (Mezo testnet)

MUSD Rescue is a liquidation-prevention and collateral-health instrument for borrowers of **MUSD, Mezo's Bitcoin-backed stablecoin**. It reads real MUSD troves straight from the protocol contracts on Mezo testnet, measures how close each one is to the 110% liquidation line, simulates rescues against the contract's own rules, and prepares the real `repayMUSD` / `addColl` transaction only after an explicit confirmation screen, then verifies the result on-chain.

> Risk information only. MUSD Rescue cannot guarantee that liquidation will be prevented.

---

## The problem

An MUSD trove is liquidated by anyone the moment its collateral ratio (ICR) drops below 110%. Borrowers have to answer, under time pressure:

- How far can BTC fall before I am liquidated?
- How much MUSD do I need to repay, or BTC to add, to get back to safety?
- Will the contract even accept my rescue? (A repayment can be rejected because of the 1,800 MUSD minimum net debt, or because it does not lift ICR back over 110% in one go.)
- Did my transaction actually work?

## The solution

| | What MUSD Rescue does |
|---|---|
| **Monitor** | Live ICR, health factor, liquidation price, room to liquidation, interest accrual, system TCR and distance to Recovery Mode, refreshed every 15 s. |
| **Simulate** | Price scenarios (presets and a drag slider), repay / add-collateral / combined rescues, a target-health-factor solver and a side-by-side comparison of rescue options with trade-offs. Every check mirrors a `require` in `BorrowerOperations`. |
| **Act** | Server prepares the transaction from fresh state (hints, `eth_call` simulation, explicit gas), the client independently decodes it, you confirm, your wallet signs. |
| **Verify** | Receipt verified server-side (status, contract, sender, `TroveUpdated` event, exact MUSD burn), trove re-read at the receipt block and the block before (same oracle price), recorded once per tx hash. |
| **Warn** | Alert rules (warning/critical zone, HF drop, price drop, unexpected debt, stale data, Recovery Mode) with frequency and quiet hours, evaluated by a daily cron, on every visit and on Check now. |

## Features that work today

- **Wallet connection** with EIP-6963 multi-wallet discovery (MetaMask, Rabby, OKX…), custom connect modal, explicit unsupported-network banner, add/switch Mezo Testnet, add MUSD to wallet.
- **Sign-In with Ethereum** (EIP-4361): server nonce (single use, 10 min), domain/URI/chain/expiry checks, HttpOnly signed-JWT session.
- **Risk dashboard** (`/dashboard`): your trove plus watched troves, totals, weakest position (no misleading blended health factor), healthy / needs-attention / critical counts, data source and freshness, empty state with next steps.
- **Position detail** (`/positions/[address]`): collateral and debt breakdown (principal, 200 MUSD gas compensation, recorded + accrued interest, pending redistribution), redemption-order rank, **real on-chain history** of the oracle price and the trove's health factor (archive `eth_call` at past blocks), optional CoinGecko reference line clearly labelled external, protocol event log, inline alert rules, share link, printable report.
- **Rescue simulator** (`/rescue/[address]`): the signature feature. Scenario + rescue panels, clearance gauge with simulated marker, minNetDebt-aware max buttons, target solver, compare table, and the live transaction flow (prepare → confirm → sign → receipt → verify → refresh) with rejected / reverted / disconnected / wrong-network / expired-quote handling and a "your position got riskier since you opened the simulator" warning.
- **Liquidation radar** (`/radar`): all ~350 open troves read through Multicall3 at one block, histogram by collateral ratio, cumulative "debt liquidatable vs BTC drop" curve, riskiest-troves table.
- **Alerts** (`/alerts`): rule editor, monitoring status (last successful scheduled run and last check), Check now, in-app inbox, opt-in browser notifications while the app is open.
- **Activity** (`/activity`): verified rescue transactions (CSV export), event log with on-chain vs app-event labels, protocol log for your trove.
- **Settings** (`/settings`): network, session, adjustable risk categories and default target HF, live data-source health, verified contract table (testnet + mainnet read-only).
- **Demo** (`/demo`): three FICTIONAL positions (healthy, near-warning, high-risk), price slider, repay/add-collateral simulation, hatched violet styling, never touches chain or DB.
- **Signature 3D hero**: a BTC collateral sphere suspended above a glowing liquidation plane; dragging the price lowers it toward the plane and shifts green → amber → red, driven by the owner's real trove. Lazy-loaded R3F, DPR ≤ 1.75, paused off-screen and in hidden tabs, static poster for reduced motion and phones.
- Extras: ⌘K command palette (paste any address to watch it), system-health strip (oracle price, TCR, Recovery Mode distance, trove count, block, freshness), printable risk report, share links, methodology and legal pages, OG image, sitemap/robots, Vercel Analytics.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js App Router UI<br/>React 19, Tailwind 4, R3F]
    W[wagmi + viem<br/>injected / EIP-6963 wallet]
    RE1[Risk engine<br/>pure TS, bigint]
  end
  subgraph Vercel
    API[Route handlers /api/*]
    AD[MUSD adapter<br/>LendingAdapter interface]
    RE2[Risk engine<br/>same module]
    CRON[Daily cron 06:00 UTC]
  end
  DB[(Neon Postgres<br/>schema "rescue")]
  RPC[Mezo testnet RPC<br/>archive node]
  MC[Multicall3]
  MUSD[MUSD protocol<br/>BorrowerOperations, TroveManager,<br/>PriceFeed, SortedTroves, HintHelpers]
  BS[Blockscout logs API]
  CG[CoinGecko<br/>reference only]

  UI --> API
  UI --> RE1
  W -- signs confirmed rescue tx --> RPC
  API --> AD --> MC --> MUSD
  AD --> RPC
  AD --> BS
  API --> RE2
  API --> DB
  CRON --> API
  API --> CG
```

### How a rescue works, step by step

1. `GET /api/positions/:owner`: one Multicall3 batch reads `Troves`, `getEntireDebtAndColl`, `fetchPrice`, system collateral/debt, protocol parameters, MUSD and BTC balances and the block number/timestamp, all at one block.
2. The simulator runs the risk engine locally on those numbers for instant feedback.
3. **Review transaction** → `POST /api/rescue/prepare`: the server re-reads the trove at the latest block, validates the amounts with the same engine, computes SortedTroves hints, runs `eth_call` from the owner, estimates gas and applies `max(estimate × 1.3, floor)`.
4. The browser decodes the calldata, checks the target contract and chain, and shows contract, network, asset, amount, before → after ICR/HF, gas, approval explanation and a 60 s quote timer.
5. The wallet signs and sends; the UI tracks pending → receipt.
6. `POST /api/rescue/verify` verifies the receipt and records it (unique tx hash), then the trove is re-read and the improvement is shown.

## Mezo / MUSD integration

The integrated lending protocol is **MUSD itself** (Liquity-style CDP: BTC collateral → MUSD debt), verified in the official source `github.com/mezo-org/musd` and live on Mezo testnet.

| Contract | Mezo testnet (chain 31611) |
|---|---|
| BorrowerOperations | [`0xCdF7028ceAB81fA0C6971208e83fa7872994beE5`](https://explorer.test.mezo.org/address/0xCdF7028ceAB81fA0C6971208e83fa7872994beE5) |
| TroveManager | [`0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0`](https://explorer.test.mezo.org/address/0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0) |
| PriceFeed | [`0x86bCF0841622a5dAC14A313a15f96A95421b9366`](https://explorer.test.mezo.org/address/0x86bCF0841622a5dAC14A313a15f96A95421b9366) |
| SortedTroves | [`0x722E4D24FD6Ff8b0AC679450F3D91294607268fA`](https://explorer.test.mezo.org/address/0x722E4D24FD6Ff8b0AC679450F3D91294607268fA) |
| HintHelpers | [`0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6`](https://explorer.test.mezo.org/address/0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6) |
| InterestRateManager | [`0xD4D6c36A592A2c5e86035A6bca1d57747a567f37`](https://explorer.test.mezo.org/address/0xD4D6c36A592A2c5e86035A6bca1d57747a567f37) |
| StabilityPool | [`0x1CCA7E410eE41739792eA0A24e00349Dd247680e`](https://explorer.test.mezo.org/address/0x1CCA7E410eE41739792eA0A24e00349Dd247680e) |
| MUSD token | [`0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`](https://explorer.test.mezo.org/token/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503) |
| Multicall3 | [`0xcA11bde05977b3631167028862bE2a173976CA11`](https://explorer.test.mezo.org/address/0xcA11bde05977b3631167028862bE2a173976CA11) (bytecode verified present) |

Sources: `solidity/artifacts/deployments/matsnet/*.json` in mezo-org/musd (matsnet = Mezo testnet; its MUSD address matches the [Mezo contracts reference](https://mezo.org/docs/users/resources/contracts-reference)). Mainnet addresses from `deployments/mainnet` are listed in Settings for read-only reference. All addresses live in `src/config/contracts.ts`; ABIs in `src/config/abis.ts` are copied verbatim from the artifacts. `npm run probe` re-checks bytecode, parameters, oracle freshness and the no-approval repay path live.

**No custom smart contract is deployed.** The spec asks not to add one without need, and none is needed: rescues call BorrowerOperations directly from the user's wallet.

### Live rescue transactions (e2e, owner's trove `0x10ac…B628`)

| Action | Tx | Block | Effect (same oracle price) |
|---|---|---|---|
| `addColl` 0.00001 BTC | [`0x0bd5dc07…3b47`](https://explorer.test.mezo.org/tx/0x0bd5dc075099b8158caf7795cc140150ff14e7055485b1a0888d6f13db023b47) | 16,382,235 | ICR 155.213% → 155.247% |
| `repayMUSD` 5 MUSD | [`0x175519a8…bb2f`](https://explorer.test.mezo.org/tx/0x175519a8212682dda3b66f345bb091d4baad092bfd48b1fe517e266830f3bb2f) | 16,382,239 | ICR 155.212% → 155.550% |

Both were prepared by the app's `/api/rescue/prepare` (gas 494,029 / 471,151 with estimates 380k / 362k), signed locally, verified by `/api/rescue/verify` and are visible in the trove's on-chain activity.

## Risk methodology

Full write-up in-app at [`/methodology`](https://musd-rescue.vercel.app/methodology). Summary of the rules, all read from the MUSD source:

- **Debt** = principal + interest from `getEntireDebtAndColl` (includes accrued interest to the current block and pending redistribution). Principal includes the borrowed amount, the 0.1% borrowing fee and the **200 MUSD gas compensation**.
- **Interest** is simple: `principal × rateBps × seconds / (10,000 × 31,556,952)` at the trove's fixed rate (1.00% on testnet).
- **ICR** = `coll × price / debt` with Solidity floor division. Our value equals `TroveManager.getCurrentICR` exactly (asserted in the e2e).
- **Health factor** = ICR ÷ MCR (110%). HF 1.00 is the liquidation line; ICR is always shown next to it.
- **Liquidation price** = `debt × MCR / coll` (rounded up). **Room to liquidation** = drop from the current oracle price.
- **Recovery Mode** when TCR < CCR (150%). Shown prominently with the BTC drop that would trigger it. **Important finding:** unlike Liquity v1 / THUSD, *MUSD does not liquidate troves between 110% and 150% in Recovery Mode*. `TroveManager._getTotalsFromBatchLiquidate` liquidates only `ICR < MCR`, and the MUSD CHANGELOG says "Liquidations are now the same in recovery mode and normal mode". Recovery Mode instead blocks withdrawals, closing and refinancing, waives the borrowing fee and requires new debt to leave ICR ≥ 150% and improve it. The engine keeps a per-protocol `recoveryModeLiquidationThreshold` (null for MUSD, CCR for a Liquity-v1-style adapter) and both behaviours are unit tested.
- **minNetDebt**: after a repayment, `debt − 200 − repay ≥ 1,800`. The maximum repayment without closing is `debt − 2,000`; more requires `closeTrove()` (needs `debt − 200` MUSD and is blocked in Recovery Mode). The simulator enforces this and says so.
- **Normal Mode adjustments**: every adjustment, including a repayment or top-up, must leave ICR ≥ 110% and TCR ≥ 150%, otherwise it reverts. The simulator blocks rescues that are too small.
- **Repayments pay interest first**, then principal.
- **No approval needed for repayment**: BorrowerOperations burns MUSD directly via `MUSD.burn` (it is on `burnList`, verified live), so allowance is never read. Confirmed by simulating `repayMUSD` from a wallet with zero allowance.
- **Hints**: NICR = `coll × 1e20 / principal` (the sorted list ignores interest, as in `getNominalICR`), `getApproxHint(NICR, ⌈15·√n⌉, seed)`, `findInsertPosition`. With correct hints a repay costs ~360k gas instead of ~4M.
- **Risk categories** (configurable in Settings): healthy > 2.0, caution 1.5–2.0, high 1.2–1.5, critical ≤ 1.2, liquidatable < 1.0.
- **Stale data**: `PriceFeed.fetchPrice()` reverts if the oracle is > 60 s old; then every operation would revert, so rescue actions are disabled. Client data is marked aging after 45 s and stale after 2 min; stale data disables rescue actions.

## Transaction safety model

Non-custodial; no keys or seed phrases are ever requested. No transaction is initiated without an explicit click on the confirmation screen and a wallet signature. Transaction-critical parameters come from a fresh server-side read, not from the client's simulation. Every write carries an explicit gas limit (Mezo enforces the EIP-7623 calldata floor and the public RPC has returned bogus low estimates). The client checks the prepared calldata decodes to the amounts entered and targets BorrowerOperations on chain 31611. Success is shown only after a verified receipt and a re-read of the trove. Only debt repayments and collateral top-ups are ever prepared; borrowing appears only as a calculator.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Radix primitives · cmdk · sonner · Recharts · React Three Fiber + drei · wagmi 2 + viem 2 + TanStack Query · Neon Postgres (`@neondatabase/serverless`) · jose (JWT sessions) · zod · Vitest · tsx · Vercel (functions, cron, analytics).

## Local setup

```bash
npm install
vercel link --yes --project musd-rescue      # or create your own Neon database
vercel env pull .env.local --yes             # DATABASE_URL, SESSION_SECRET, CRON_SECRET
npm run db:migrate                           # idempotent, creates schema "rescue"
npm run dev                                  # http://localhost:3000
```

Get testnet BTC for gas from the [Mezo faucet](https://faucet.test.mezo.org/). Add Mezo Testnet to your wallet from the account menu (chain 31611, RPC `https://rpc.test.mezo.org`).

### Environment variables (`.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `SESSION_SECRET` | HS256 key for the session cookie (48 random bytes) |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/monitor` |
| `NEXT_PUBLIC_MEZO_TESTNET_RPC` | optional RPC override |
| `NEXT_PUBLIC_SITE_URL` | optional canonical URL |
| `DEPLOYER_ENV_FILE`, `TEST_WALLETS_FILE`, `E2E_BASE_URL` | e2e script only (paths to key files outside the repo, never copied) |

## Database schema (`rescue`)

| Table | Contents |
|---|---|
| `siwe_nonces` | single-use sign-in nonces with expiry |
| `users` | wallet address, preferences (risk thresholds, target HF, browser notifications) |
| `watchlist` | troves a user follows |
| `alert_rules` | kind, threshold, frequency, channel, quiet hours, timezone, baseline, last evaluated/triggered |
| `notifications` | in-app alerts (severity, quiet flag, source: cron/visit/check_now) |
| `oracle_snapshots` | observed oracle price, TCR, Recovery Mode, totals (unique per block) |
| `trove_snapshots` | observed trove state and ICR (unique per owner + block) |
| `rescue_txs` | verified rescue transactions, **UNIQUE tx_hash**, ICR before/after |
| `activity` | on-chain vs off-chain events, idempotency keys |
| `monitor_runs` | every monitoring run with outcome, used for "last successful monitoring" |

## Supported networks

- **Mezo Testnet (31611)**: full support, reads and rescue transactions.
- **Mezo Mainnet (31612)**: contract addresses listed read-only; no transactions. (The mainnet deployment artifacts currently report a single trove on the probed TroveManager, so live mainnet analytics were not prioritised.)
- Any other chain: explicit unsupported-network banner with a standard wallet switch.

## Testing

```bash
npm test          # Vitest unit tests
npm run lint      # ESLint (clean)
npm run build     # production build (zero type errors)
npm run probe     # live read-only protocol probe
E2E_BASE_URL=http://localhost:3100 npm run e2e   # live e2e (sends 2 small real txs)
E2E_SKIP_TX=1 E2E_BASE_URL=https://musd-rescue.vercel.app npm run e2e
```

Latest results (2026-10-26):

- **Vitest: 91 / 91 passing** across 5 files: health factor, collateral thresholds, liquidation price, interest accrual, repay and add-collateral simulation, combined adjustments, minNetDebt cap, Normal-Mode MCR revert, Recovery Mode (MUSD vs Liquity-v1 semantics, fee waiver, borrow rules), target-HF solvers, option comparison, token decimals (incl. 6-decimal tokens), zero debt, zero collateral, missing/stale price, extreme moves (−100%, +1000%, 1e40 prices), unsupported networks, wallet disconnection, failed and rejected transactions, rejected approvals, successful repayment and post-transaction refresh, receipt verification (reverted, wrong contract, wrong sender, burn mismatch, missing event, unconfirmed, non-rescue calls), gas floors, alert rules (transitions, cooldowns, deltas, quiet hours, stale data), demo/live separation.
- **Live e2e, local `next start`: 36 / 36** including the two real rescue transactions above.
- **Live e2e, production: 21 / 21** (read paths, SIWE, negatives, re-verification of the two transactions through the deployed app, alerts).
- Post-deploy: every page route and `/api/health` return 200; unknown route 404; cron without secret 401.

## Known limitations

- Monitoring is not continuous: Vercel Hobby allows one cron per day (06:00 UTC); checks also run on every visit (throttled to once a minute) and on Check now. A fast BTC move between checks is not caught.
- Alerts are in-app plus browser notifications while a tab is open. No email/SMS/Telegram (no delivery infrastructure was built and tested).
- Prepared transactions do not use EIP-712 `*WithSignature` flows; the wallet sends `repayMUSD` / `addColl` / `adjustTrove` directly.
- Closing a trove is explained but not offered as a one-click action.
- Health-factor history covers the trove's lifetime only; history before a trove opened is empty by design.
- The in-memory rate limiter and caches are per serverless instance.
- Mainnet is reference-only (see above).

## Security notes

No private keys in the repo, env files or bundle; the e2e script reads keys at runtime from files outside the project. Sessions are HttpOnly, Secure, SameSite=Lax JWTs; state-changing routes check Origin. All inputs validated with zod; every user-owned row is authorised against the session; tx hashes are unique; on-chain claims are verified from receipts, never trusted from the client. Security headers (HSTS, frame-deny, nosniff, referrer and permissions policy) are set globally.

## Demo script (2 minutes)

1. Open **https://musd-rescue.vercel.app**. Drag the BTC slider under the 3D scene: the owner's real trove sinks toward the red 110% plane and turns from amber to red. The strip at the top shows the live oracle, TCR and Recovery Mode distance.
2. Click **Liquidation radar**: ~350 real troves, how many fall below 110% after a 10% or 20% drop.
3. Paste `0x10ac9924a78051BdD770978740C5084205cdB628` into "Check any trove" (or ⌘K): live ICR 155.5%, HF 1.41 (high risk), debt breakdown with the 200 MUSD gas compensation, real oracle and HF history, the two rescue transactions in the activity log.
4. Open **Rescue simulator**: pick −20%, see it become critical; set target HF 1.5 and compare "Repay MUSD" (~125 MUSD), "Add BTC" and "Both"; try repaying 1,000 MUSD and see the minNetDebt block.
5. With your own wallet: get testnet BTC at https://faucet.test.mezo.org/, open a trove in the Mezo app, connect here, sign in, and rescue it: confirmation screen → wallet → verified result.
6. Open **Demo** for three fictional positions if you have no trove.

## Pitch and roadmap

Every CDP borrower eventually faces the same five minutes: BTC is falling, and the question is how much to repay and whether the contract will accept it. MUSD Rescue answers with the protocol's own arithmetic and executes the answer safely. Next: EIP-712 signature-based rescues so a pre-authorised keeper could act within user-set limits, Stability Pool-aware liquidation previews, push/email delivery, a mainnet read-only view once MUSD's mainnet deployment artifacts are confirmed, and more Mezo lending adapters through the existing `LendingAdapter` interface.

---

Original product specification: [`project.md`](./project.md).
