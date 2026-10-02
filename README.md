# ميزان — إدارة المشاريع ورأس المال

Private Arabic financial workspace on Sites. Amounts are stored as integer halalas. Every request is scoped by the platform-authenticated user id. Accounting journals are balanced, immutable, idempotent and corrected using reversal entries. D1 batches make posting and associated state changes atomic; optimistic project locks prevent simultaneous financial mutations from evaluating stale balances.

## Implemented

- Operating projects, ownership ratios, external investment register and internal financing and repayments with per-counterparty balances.
- Double-entry transaction templates, manual adjustments, locked periods, audit history.
- Planned recurring inflows and outflows; actual settlement produces a journal exactly once.
- Employee records, bounded monthly payroll schedules and renewal without duplicate months.
- New and opening loans, declining-balance estimates, bank-supplied schedule replacement and early repayment.
- 91-day cash forecast with 13 weekly summaries, intraday-conservative minimums, stress scenarios, distribution eligibility and project reserve checks.
- Risk register, liquidity/overdue/loss indicators and concentration monitoring.
- Income statement, balance sheet, trial balance, CSV export and print-to-PDF; JSON archive download.
- Read-only illustrative demo; no demo rows are written to real data.

## Important boundaries

This is an internal management and bookkeeping workspace, not audited statutory accounts or investment advice. Tax/Zakat calculations, ZATCA e-invoicing, bank feeds, payroll compliance, inventory quantity tracking, automated depreciation, multi-bank reconciliation, multi-currency accounting and historical ownership changes are not automated. Journal entries can record their financial effects. External investments are recorded at cost plus received returns, not fair value or the equity method. Multi-project totals are management aggregation rather than statutory consolidation.

Distribution eligibility uses cumulative recorded income plus prior retained earnings, the recorded ownership and distribution policy, minus distributions already posted; it is not a legal determination of distributable reserves. Verify period-end adjustments and partner approvals. The cash test only sees entered obligations and assumes they occur as forecast. Loan estimates are nominal-rate amortization rather than APR calculations; actual payments and revisions must follow bank documentation.

Employee records are payroll administration records, not employee login accounts. The Site is owner-private; there is no team access/RBAC administration. Backups can be downloaded; restore is not implemented. The app exposes a read-only WebMCP tool when supported.

## Verification

Run `node tests/finance.test.mjs` for real Worker/D1 API integration checks with isolated local data, including authorization, duplicate submissions, journal integrity, repayments, revised schedules, period locks, payroll dates and concurrent distributions. Run `node node_modules/typescript/bin/tsc --noEmit` for the UI type check.

Database schema uses append-only Drizzle migrations. Do not edit applied migrations. No production test data is seeded.

## Development and GitHub

Requirements: Node.js 22.13+ and pnpm 11.25.0. Install with `corepack pnpm install --frozen-lockfile`, then run `corepack pnpm dev`. Run `corepack pnpm test` and `corepack pnpm typecheck` before publishing. GitHub Actions runs both checks for pushes and pull requests.

Hosting uses Cloudflare Workers and D1 through Sites. A GitHub copy is source control, not a transfer of the production database or authentication service. Preserve the Sites source remote when adding a GitHub remote. Never commit `.env` files, tokens, D1 data, downloaded financial backups, or generated build output.

The API trusts `oai-authenticated-user-id` only behind the Sites authenticated gateway. Do not expose the Worker directly on another host without adding a trusted authentication gateway that removes spoofed identity headers. Local integration tests inject identity only into an isolated Miniflare instance. A generic static host cannot run this application's API or database.

## Financial behavior in 0.2.0

- Forecast minimums include the opening cash balance after a proposed outlay and every day's balance before incoming collections. This prevents an end-of-week receipt from hiding an earlier payment shortfall. Payments are assumed to precede receipts on the same day; weekly closing balances remain visible separately.
- Suggested future withdrawal dates are after that day's recorded collections and inspect every subsequent day within the existing 91-day horizon. They are conditional forecasts, not guarantees or automated payments.
- Actual distributions are recorded with today's date so current cash and entitlement checks are meaningful. Amounts are floored to whole halalas.
- Internal funding repayments reduce the borrower's payable and lender's receivable without recording profit. The repayment cannot exceed the amount recorded for that project pair.
- Payroll renewal starts after the employee's last scheduled month, retains the original day-of-month convention and does not modify paid or previously scheduled amounts.
