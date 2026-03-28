# StoreOS — Complete Project Documentation

This documentation serves three purposes:
1. Record exactly what was agreed vs what was built
2. Serve as a finalization and security checklist before final delivery
3. Stand as a permanent technical reference for the codebase

---

## PROJECT CONTEXT

**Application name:** StoreOS
**Type:** Custom private web application — inventory management, OCR scanning, accounting, and business analytics
**Stack:** Vite + Vanilla JS frontend · Supabase (PostgreSQL + Row Level Security) · Vercel deployment · Google Vision API for OCR
**Delivery timeline:** 14 days
**Delivery format:** Live URL on Vercel · full code ownership transferred · no ongoing licence fees

---

## SECTION 1 — PROJECT OVERVIEW

StoreOS is a multi-store, multi-tenant inventory and accounting web application designed for retail store owners. It replaces manual notebooks and spreadsheets with a live, searchable, secure web app accessible from any device.

**Problem Solved:** The client currently manages 2 stores manually using notebooks and spreadsheets, making it difficult to track inventory, sales, expenses, and cash positions across locations in real-time.

**Full Stack Implementation:**
- **Frontend:** Vite + Vanilla JavaScript with Zustand for state management
- **Backend:** Supabase (PostgreSQL with Row Level Security)
- **Authentication:** Supabase Auth with multi-tenant isolation
- **File Storage:** Supabase Storage for receipt archives
- **OCR:** Google Vision API via Supabase Edge Function proxy
- **Deployment:** Vercel with automatic SSL and CI/CD
- **PWA:** Progressive Web App with native mobile experience

**Infrastructure:**
- **Database:** PostgreSQL on Supabase with automatic backups
- **API:** RESTful via Supabase with real-time subscriptions
- **Security:** Row Level Security (RLS) on all tables
- **Performance:** Image compression, lazy loading, and optimized queries
- **Mobile:** PWA manifest, responsive design, offline capability

**Delivery Model:**
- Web application accessible from any browser
- Mobile-ready PWA with "Add to Home Screen" capability
- No app store required - direct installation
- Fullscreen native-like experience on mobile devices
- Cross-platform compatibility (iOS Safari, Android Chrome, Desktop browsers)

**Post-Delivery Support:** 30 days from delivery date covering bug fixes, security issues, and critical functionality problems.

---

## SECTION 2 — ORIGINAL AGREED SCOPE

These are the exact 6 modules that were agreed and delivered:

| Module Name | What Was Agreed | What Was Delivered | Status |
|-------------|----------------|-------------------|---------|
| Dashboard & Analytics | Live KPIs showing today's sales, expenses, profit and inventory value. Sales and expense charts. Low-stock alerts. Recent activity feed. 7-day chart. | All of the above plus date range selector that recalculates all KPIs for any custom period. | Exceeded |
| Inventory Management | Add and edit items. Stock-in and stock-out tracking. Search and filter. Item history log. Low-stock threshold alerts. | All of the above. Items link to transactions. Stock movements traceable to specific sales and purchases. | Delivered |
| Unified Transactions | Single ledger for sales, expenses, and stock movements — fully linked and traceable. Filter by type and date. | Full ledger with payment method filters (cash, bank transfer, credit). All movements linked to source records. | Delivered |
| OCR Scanner & Editor | Camera capture and file upload. Google Vision AI extraction. Editable review table. Dynamic field mapping. Routes to Inventory, Sales, or Expenses in one tap. | All of the above. Mobile-optimized as a full bottom-sheet on small screens. Receipt total validation before saving — system flags mismatches between scanned line items and receipt total. | Exceeded |
| Reports & History | Date-range reports. Top items by volume and value. Profit and loss summary. OCR scan history log. | All of the above. Profit calculation is configurable — user defines rules in a settings panel (deduct expenses, unpaid debts, cost price) and dashboard reflects actual margin. | Exceeded |
| Deployment & Handover | Free live deployment on Vercel. Walkthrough session. User guide. 30-day support window. | Live on Vercel. PWA manifest implemented — add to home screen on iOS and Android, runs fullscreen with saved login. 30-day support window active from delivery day. | Delivered |

---

## SECTION 3 — OUT OF SCOPE FEATURES DELIVERED

These 13 features were built beyond the original agreed scope:

| Feature Name | Description | Why Added | Estimated Hours |
|--------------|-------------|-----------|-----------------|
| Mobile OCR bottom-sheet | Full mobile-optimized receipt review. On small screens the review editor opens as a bottom-sheet drawer instead of a full page. Columns stack vertically. Scanned line items are validated against the receipt total before saving — mismatches are flagged. | Original OCR editor was unusable on mobile screens. Business owner uses phone as primary device. | 6 |
| Bank account linking on stock purchases | Every stock purchase now records which bank account the payment came from. Cash balances update automatically per account. | Without this, cash positions were inaccurate after stock purchases — money left the bank but the bank balance didn't update. | 4 |
| Dashboard date range selector | Custom period picker on the dashboard. All KPIs — sales, expenses, profit, inventory value — recalculate for the selected window in real time. | Business owner needs to compare performance across different periods, not just today. | 5 |
| Dedicated Sales History page | Separate page with full transaction history. Search by product name or amount. Filter by date range and payment method. View and share individual receipts per transaction. | The unified transactions ledger covers all types — a dedicated sales view was needed for daily reconciliation. | 7 |
| Real profit calculation engine | Settings panel where the user defines their own profit rules: whether to deduct expenses, outstanding debts, or cost price from gross sales. Dashboard and reports reflect the configured margin, not just gross sales minus expenses. | Default profit = sales minus expenses was too simplistic for a multi-account business with supplier debts. | 8 |
| Supplier to payment to inventory flow | Paying a supplier now creates a linked chain: bank account balance decreases, payment record is created, and the inventory items purchased are updated — all in one transaction. Everything traces back to one source record. | Without this, paying a supplier and receiving stock were two disconnected actions. Full traceability required linking them. | 9 |
| Dedicated Vendors page | Full vendor management. Add, edit, view transaction history per vendor. Track outstanding balances. | Vendors and suppliers needed separate management flows — a vendor sells to the business, a supplier provides goods on account. | 5 |
| Dedicated Suppliers page | Separate from vendors. Manage supplier relationships, outstanding debts, payment history, and linked inventory purchases. | Supplier debt tracking required its own data model and UI separate from general vendor management. | 6 |
| Telebirr-inspired UI redesign | Full mobile UI overhaul. Teal gradient header showing combined cash position with eye toggle. Store Till and Bank Account sub-balances. 2x4 quick action grid. Pinned full-width scan button above footer nav. Footer nav: Home, Stock, POS, Credits, Finance, Menu. | Original dashboard was desktop-first. Business owner and future subscribers are phone-first users. Familiar financial app pattern reduces learning curve. | 12 |
| Bank account management | Add, edit, and delete multiple bank accounts per store. Each account tracks its own balance. Transfers between accounts are recorded as linked transactions. | Business operates across multiple bank accounts. Original spec assumed one account. | 5 |
| Profit settings panel | User-configurable rules for how profit is calculated. Persistent per store. Settings survive logout and session changes. | Required by the real profit calculation engine (feature 5). Without it, the calculation would apply the same rules to all users. | 3 |
| Payment method filters | Filter sales and transaction records by payment method: cash, bank transfer, or credit. Works across Sales History, Transactions ledger, and Reports. | Business accepts multiple payment methods and needs to reconcile cash vs bank separately at end of day. | 3 |
| Smart inventory tracker | After any sale is recorded, the system checks whether each product in the sale exists in inventory. For any missing product, a modal appears with three choices: Skip (record the sale, ignore inventory for this item), Match (confirm a suggested similar product and deduct quantity), or Create new (user enters starting quantity, system calculates remainder after the sale automatically). | Business owner was recording sales before setting up inventory. Without this, sales created no inventory movements and stock levels became inaccurate silently. | 10 |

---

## SECTION 4 — FINALIZATION PLAN

### Friday — Feature freeze and functional testing

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

### Saturday — Security, RLS, and performance

**RLS audit — check every Supabase table:**
- [ ] RLS enabled on all tables — no table left open
- [ ] Every policy restricts reads and writes to the authenticated user's own store_id
- [ ] Test data isolation: create two user accounts, confirm neither can see the other's data
- [ ] Document each table name and its RLS policy in the known issues log

**Security checklist:**
- [ ] No API keys in frontend code or git history — check with `git log -S "sk-"` and `git log -S "eyJ"`
- [ ] Google Vision API key restricted to Vercel domain only in Google Cloud Console
- [ ] Supabase anon key has no service_role permissions
- [ ] No `console.log` statements exposing user data, tokens, or API responses in production build
- [ ] Auth redirect works correctly on session expiry — user lands on login, not a blank screen
- [ ] Logout clears session completely — no stale data in localStorage

**Performance checklist:**
- [ ] Image compression active on OCR uploads — target under 1MB before sending to Google Vision
- [ ] Inventory list lazy-loads or paginates beyond 50 items
- [ ] Transactions and sales history paginate beyond 50 items
- [ ] Dashboard KPIs load from a single query — not multiple sequential round trips
- [ ] Supabase indexes exist on: store_id, created_at, product_id across all main tables
- [ ] Run Lighthouse audit on live Vercel URL — target 80+ performance score

### Sunday — Final delivery

- [ ] Full end-to-end walkthrough on mobile — every feature, every flow
- [ ] Confirm all 6 original modules work completely
- [ ] Confirm all 13 out-of-scope features work completely
- [ ] Lighthouse score 80+ confirmed
- [ ] Final git commit tagged v1.0
- [ ] 30-day support window begins today — confirm in writing
- [ ] Handover checklist completed and signed off

---

## SECTION 5 — KNOWN ISSUES LOG

| Issue | Severity (critical / medium / low) | Status (fixed / in progress / deferred) | Notes |
|-------|-----------------------------------|----------------------------------------|-------|
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |
| | | | |

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

**Supabase**
- Free tier: 500MB database, 1GB storage, 50MB file upload limit, 2GB bandwidth
- Current usage: Single store with ~1000 transactions/month stays well within limits
- Paid (Pro $25/month): Unlimited database size, 100GB storage, needed when expanding to multiple subscriber stores, typically year two onwards
- Enterprise: Custom pricing for high-volume multi-tenant SaaS

**Google Vision API**
- Free tier: 1,000 document scans per month, always free
- Current usage: At 20 receipts per day = approximately 600 scans per month — stays on free tier
- Paid: $1.50 per additional 1,000 scans beyond free tier
- Rate limits: 15 requests per second on free tier

**Vercel**
- Free tier: Hosting included, 100GB bandwidth/month, 100 builds/month
- Current usage: Single store app well within limits
- Paid (Pro $20/month): Unlimited bandwidth, custom domains, advanced analytics
- Custom domain: Approximately $12 per year through Vercel or external registrar

**Cost Projections for Single Store:**
- Monthly: $0 (all services on free tiers)
- Annual: $12 for custom domain (optional)
- Year 2+: $25/month Supabase Pro if expanding to multiple stores or hitting storage limits

---

## TECHNICAL ARCHITECTURE

### Database Schema
Based on migrations and code analysis:

**Core Tables:**
- `stores` - Multi-store support with accounting_view toggle
- `cash_accounts` - Till and bank accounts with balance tracking
- `inventory_items` - Products with stock levels and cost data
- `stock_movements` - Ledger for all inventory changes
- `sales` and `sale_items` - Transaction records with payment methods
- `expenses` - Business expenses with receipt attachments
- `cash_transfers` - Money movement between accounts
- `ocr_logs` - Complete OCR scan history and results
- `vendors` and `vendor_purchases` - Supplier management
- Additional tables for credits, accounting, and audit features

**Security Implementation:**
- Row Level Security enabled on all tables
- Multi-tenant architecture via owner_id and store_id
- API keys isolated to Supabase Edge Functions
- No direct database access from frontend

### Frontend Architecture
- **Framework:** Vanilla JavaScript with Vite build system
- **State Management:** Zustand for global state (current store, user, settings)
- **Routing:** History API with client-side router
- **Styling:** Custom CSS with mobile-first responsive design
- **Components:** Modular component system with reusable UI elements
- **Performance:** Lazy loading, image compression, optimized queries

### PWA Features
- **Manifest:** Complete with icons, splash screens, and standalone display
- **Service Worker:** Caching strategy for offline functionality
- **Installation:** Native app installation on iOS Safari and Android Chrome
- **Experience:** Fullscreen mode with no browser chrome
- **Performance:** Cached assets for instant loading

### OCR Pipeline
1. **Capture:** Camera or file upload with validation
2. **Compression:** Canvas-based resizing to <1MB
3. **Upload:** Supabase Storage with permanent archiving
4. **Processing:** Google Vision API via Edge Function proxy
5. **Parsing:** Client-side extraction with confidence scoring
6. **Review:** Interactive editor with validation and mapping
7. **Application:** Atomic database insertion via RPC

---

## DEPLOYMENT & DEVOPS

### Current Deployment
- **Platform:** Vercel (vercel.json configuration present)
- **Domain:** Configured for production use
- **CI/CD:** Automatic deployment on git push
- **Environment:** Production Supabase instance
- **SSL:** Automatic HTTPS certificate management

### Development Setup
- **Local:** Vite dev server with hot reload
- **Database:** Supabase local development environment
- **Environment:** .env file with Supabase configuration
- **Build:** `npm run build` creates optimized production bundle

### Monitoring & Maintenance
- **Error Tracking:** Console logging and user feedback
- **Performance:** Lighthouse audits and optimization
- **Backups:** Supabase automatic database backups
- **Updates:** Vercel automatic security updates

---

This documentation represents the complete technical and functional specification of StoreOS as delivered. All features have been implemented according to the PROJECT.md specifications and enhanced with the additional features listed above.
