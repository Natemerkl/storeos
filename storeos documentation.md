You are a senior full stack developer and technical writer. Produce a complete, professional project documentation file for a web application called StoreOS — a custom private inventory and accounting system.

This documentation serves three purposes:
1. Record exactly what was agreed vs what was built
2. Serve as a finalization and security checklist before final delivery
3. Stand as a permanent technical reference for the codebase

Do not invent anything. Use only what is provided below. Write in clean markdown with proper headers, tables where relevant, and checkboxes for all checklist items. No filler, no vague language — every item must be specific and actionable.

---

## PROJECT CONTEXT

**Application name:** StoreOS
**Type:** Custom private web application — inventory management, OCR scanning, accounting, and business analytics
**Stack:** Next.js / React frontend · Supabase (PostgreSQL + Row Level Security) · Vercel deployment · Google Vision API for OCR
**Delivery timeline:** 14 days
**Delivery format:** Live URL on Vercel · full code ownership transferred · no ongoing licence fees

---

## SECTION 1 — PROJECT OVERVIEW

Write a concise technical overview covering:
- What StoreOS is and what problem it solves
- The full stack used (listed above)
- Deployment infrastructure (Vercel, Supabase, Google Vision)
- Delivery model (web app, mobile-ready PWA, no app store required)
- Post-delivery support window: 30 days

---

## SECTION 2 — ORIGINAL AGREED SCOPE

These are the exact 6 modules that were agreed and delivered. For each module produce a table row with: Module Name | What Was Agreed | What Was Delivered | Status.

**Module 1 — Dashboard & Analytics**
Agreed: Live KPIs showing today's sales, expenses, profit and inventory value. Sales and expense charts. Low-stock alerts. Recent activity feed. 7-day chart.
Delivered: All of the above plus date range selector that recalculates all KPIs for any custom period.
Status: Exceeded

**Module 2 — Inventory Management**
Agreed: Add and edit items. Stock-in and stock-out tracking. Search and filter. Item history log. Low-stock threshold alerts.
Delivered: All of the above. Items link to transactions. Stock movements traceable to specific sales and purchases.
Status: Delivered

**Module 3 — Unified Transactions**
Agreed: Single ledger for sales, expenses, and stock movements — fully linked and traceable. Filter by type and date.
Delivered: Full ledger with payment method filters (cash, bank transfer, credit). All movements linked to source records.
Status: Delivered

**Module 4 — OCR Scanner & Editor**
Agreed: Camera capture and file upload. Google Vision AI extraction. Editable review table. Dynamic field mapping. Routes to Inventory, Sales, or Expenses in one tap.
Delivered: All of the above. Mobile-optimized as a full bottom-sheet on small screens. Receipt total validation before saving — system flags mismatches between scanned line items and receipt total.
Status: Exceeded

**Module 5 — Reports & History**
Agreed: Date-range reports. Top items by volume and value. Profit and loss summary. OCR scan history log.
Delivered: All of the above. Profit calculation is configurable — user defines rules in a settings panel (deduct expenses, unpaid debts, cost price) and dashboard reflects actual margin.
Status: Exceeded

**Module 6 — Deployment & Handover**
Agreed: Free live deployment on Vercel. Walkthrough session. User guide. 30-day support window.
Delivered: Live on Vercel. PWA manifest implemented — add to home screen on iOS and Android, runs fullscreen with saved login. 30-day support window active from delivery day.
Status: Delivered

---

## SECTION 3 — OUT OF SCOPE FEATURES DELIVERED

These 13 features were built beyond the original agreed scope. For each one produce: Feature Name | Description | Why Added | Estimated Hours.

1. **Mobile OCR bottom-sheet**
Full mobile-optimized receipt review. On small screens the review editor opens as a bottom-sheet drawer instead of a full page. Columns stack vertically. Scanned line items are validated against the receipt total before saving — mismatches are flagged.
Why added: Original OCR editor was unusable on mobile screens. Business owner uses phone as primary device.
Estimated hours: 6

2. **Bank account linking on stock purchases**
Every stock purchase now records which bank account the payment came from. Cash balances update automatically per account.
Why added: Without this, cash positions were inaccurate after stock purchases — money left the bank but the bank balance didn't update.
Estimated hours: 4

3. **Dashboard date range selector**
Custom period picker on the dashboard. All KPIs — sales, expenses, profit, inventory value — recalculate for the selected window in real time.
Why added: Business owner needs to compare performance across different periods, not just today.
Estimated hours: 5

4. **Dedicated Sales History page**
Separate page with full transaction history. Search by product name or amount. Filter by date range and payment method. View and share individual receipts per transaction.
Why added: The unified transactions ledger covers all types — a dedicated sales view was needed for daily reconciliation.
Estimated hours: 7

5. **Real profit calculation engine**
Settings panel where the user defines their own profit rules: whether to deduct expenses, outstanding debts, or cost price from gross sales. Dashboard and reports reflect the configured margin, not just gross sales minus expenses.
Why added: Default profit = sales minus expenses was too simplistic for a multi-account business with supplier debts.
Estimated hours: 8

6. **Supplier to payment to inventory flow**
Paying a supplier now creates a linked chain: bank account balance decreases, payment record is created, and the inventory items purchased are updated — all in one transaction. Everything traces back to one source record.
Why added: Without this, paying a supplier and receiving stock were two disconnected actions. Full traceability required linking them.
Estimated hours: 9

7. **Dedicated Vendors page**
Full vendor management. Add, edit, view transaction history per vendor. Track outstanding balances.
Why added: Vendors and suppliers needed separate management flows — a vendor sells to the business, a supplier provides goods on account.
Estimated hours: 5

8. **Dedicated Suppliers page**
Separate from vendors. Manage supplier relationships, outstanding debts, payment history, and linked inventory purchases.
Why added: Supplier debt tracking required its own data model and UI separate from general vendor management.
Estimated hours: 6

9. **Telebirr-inspired UI redesign**
Full mobile UI overhaul. Teal gradient header showing combined cash position with eye toggle. Store Till and Bank Account sub-balances. 2x4 quick action grid. Pinned full-width scan button above footer nav. Footer nav: Home, Stock, POS, Credits, Finance, Menu.
Why added: Original dashboard was desktop-first. Business owner and future subscribers are phone-first users. Familiar financial app pattern reduces learning curve.
Estimated hours: 12

10. **Bank account management**
Add, edit, and delete multiple bank accounts per store. Each account tracks its own balance. Transfers between accounts are recorded as linked transactions.
Why added: Business operates across multiple bank accounts. Original spec assumed one account.
Estimated hours: 5

11. **Profit settings panel**
User-configurable rules for how profit is calculated. Persistent per store. Settings survive logout and session changes.
Why added: Required by the real profit calculation engine (feature 5). Without it, the calculation would apply the same rules to all users.
Estimated hours: 3

12. **Payment method filters**
Filter sales and transaction records by payment method: cash, bank transfer, or credit. Works across Sales History, Transactions ledger, and Reports.
Why added: Business accepts multiple payment methods and needs to reconcile cash vs bank separately at end of day.
Estimated hours: 3

13. **Smart inventory tracker**
After any sale is recorded, the system checks whether each product in the sale exists in inventory. For any missing product, a modal appears with three choices: Skip (record the sale, ignore inventory for this item), Match (confirm a suggested similar product and deduct quantity), or Create new (user enters starting quantity, system calculates remainder after the sale automatically).
Why added: Business owner was recording sales before setting up inventory. Without this, sales created no inventory movements and stock levels became inaccurate silently.
Estimated hours: 10

---

## SECTION 4 — FINALIZATION PLAN

Write a day-by-day checklist. Use checkbox format for every item.

**Friday — Feature freeze and functional testing**

- [ ] Confirm no new features are added after this point
- [ ] Test OCR end-to-end on the live Vercel URL — not localhost
- [ ] Test OCR on mobile Safari and Chrome
- [ ] Verify scanned receipt total validation fires correctly on mismatch
- [ ] Test bank account link on a new stock purchase — verify balance updates
- [ ] Test profit calculation rules — change settings, verify dashboard updates
- [ ] Test profit rules persist after logout and login
- [ ] Test smart inventory tracker — 3 scenarios: skip, match, create new
- [ ] Test date range selector on dashboard — verify all 4 KPIs update
- [ ] Test sales history filters — date, payment method, search
- [ ] Test supplier payment flow — verify bank balance decreases and inventory updates
- [ ] Check mobile layout on dashboard, sales history, and OCR review
- [ ] Verify PWA manifest — add to home screen on Safari iOS, verify icon and name appear correctly
- [ ] Verify app opens fullscreen with no browser bar after home screen install
- [ ] Verify login persists after closing and reopening from home screen

**Saturday — Security, RLS, and performance**

RLS audit — check every Supabase table:
- [ ] RLS enabled on all tables — no table left open
- [ ] Every policy restricts reads and writes to the authenticated user's own store_id
- [ ] Test data isolation: create two user accounts, confirm neither can see the other's data
- [ ] Document each table name and its RLS policy in the known issues log

Security checklist:
- [ ] No API keys in frontend code or git history — check with `git log -S "sk-"` and `git log -S "eyJ"`
- [ ] Google Vision API key restricted to Vercel domain only in Google Cloud Console
- [ ] Supabase anon key has no service_role permissions
- [ ] No `console.log` statements exposing user data, tokens, or API responses in production build
- [ ] Auth redirect works correctly on session expiry — user lands on login, not a blank screen
- [ ] Logout clears session completely — no stale data in localStorage

Performance checklist:
- [ ] Image compression active on OCR uploads — target under 1MB before sending to Google Vision
- [ ] Inventory list lazy-loads or paginates beyond 50 items
- [ ] Transactions and sales history paginate beyond 50 items
- [ ] Dashboard KPIs load from a single query — not multiple sequential round trips
- [ ] Supabase indexes exist on: store_id, created_at, product_id across all main tables
- [ ] Run Lighthouse audit on live Vercel URL — target 80+ performance score

**Sunday — Final delivery**

- [ ] Full end-to-end walkthrough on mobile — every feature, every flow
- [ ] Confirm all 6 original modules work completely
- [ ] Confirm all 13 out-of-scope features work completely
- [ ] Lighthouse score 80+ confirmed
- [ ] Final git commit tagged v1.0
- [ ] 30-day support window begins today — confirm in writing
- [ ] Handover checklist completed and signed off

---

## SECTION 5 — KNOWN ISSUES LOG

Produce a table with these columns: Issue | Severity (critical / medium / low) | Status (fixed / in progress / deferred) | Notes

Leave 10 empty rows.

---

## SECTION 6 — HANDOVER CHECKLIST

- [ ] Live URL accessible on mobile and desktop
- [ ] Client account created and login confirmed working
- [ ] All 6 original modules accessible and functional
- [ ] OCR scans successfully on client's own device
- [ ] Bank account balances reflect real transactions
- [ ] RLS confirmed — client data is isolated
- [ ] No API keys exposed in frontend or git
- [ ] Image compression active on OCR uploads
- [ ] PWA installed on client's phone — icon and name correct, opens fullscreen
- [ ] Login persists on PWA after close and reopen
- [ ] 30-day support window start date confirmed
- [ ] Final payment confirmed received

---

## SECTION 7 — THIRD PARTY SERVICES REFERENCE

Document the following services, their free tier limits, and when paid tiers become relevant:

**Supabase**
Free tier: 500MB database, 1GB storage — sufficient for a single store indefinitely.
Paid (Pro $25/month): needed when expanding to multiple subscriber stores, typically year two onwards.

**Google Vision API**
Free tier: 1,000 document scans per month, always free.
At 20 receipts per day that is approximately 600 scans per month — stays on free tier.
Paid: beyond 1,000 scans, $1.50 per additional 1,000 scans.

**Vercel**
Free tier: hosting included. App live from delivery day at no cost.
Paid: custom domain approximately $12 per year. Optional.

---

## OUTPUT FORMAT

Produce the complete document in clean markdown. Use headers, tables, and checkboxes exactly as structured above. Every section must be complete — do not summarize or skip any item. The document should be professional enough to share with a client and detailed enough to use as a developer handover reference.