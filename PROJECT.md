# StoreOS — Project Reference

> This file is the single source of truth for the entire project.
> Read this before writing any code, making any decisions, or suggesting any changes.

---

## What We're Building

A **multi-store, multi-tenant inventory and accounting web application** for a retail store owner in Ethiopia. The system must be:

- Simple and fast on the frontend — no unnecessary complexity
- Powerful and flexible on the backend
- Built to best industry practices from day one
- Ready to scale into a SaaS product sold to other businesses

The client currently has **2 stores** and manages everything manually. This system replaces notebooks and spreadsheets with a live, searchable, secure web app accessible from any device.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | Vite + Vanilla JS | Fast, lightweight, no framework overhead |
| Styling | Pico CSS + custom CSS variables | Simple, readable, minimal |
| State | Zustand (via CDN) | Lightweight state without React |
| Routing | History API | No dependencies |
| Backend / DB | Supabase (Postgres) | Auth, storage, realtime, RLS built in |
| File Storage | Supabase Storage | Receipt and document archive |
| OCR | Google Vision API (DOCUMENT_TEXT_DETECTION) | Best accuracy for receipts |
| OCR Proxy | Supabase Edge Function | API key never exposed to browser |
| OCR Fallback | Tesseract.js | Offline / cost-saving fallback |
| Charts | Chart.js (CDN) | Simple, no build step needed |
| Deployment | Vercel (free tier) | Permanent, zero config |

---

## Architecture Decisions

### Already decided — do not change without discussion

1. **Unified transactions engine** — sales, expenses, and stock movements all flow through one ledger. Never separate logic for each.

2. **Stock movements are a ledger** — never mutate `inventory_items.quantity` directly. A Postgres trigger computes quantity from `stock_movements` inserts.

3. **`extra_fields JSONB`** on `inventory_items` and `expenses` — absorbs any unknown OCR-discovered field without schema migrations.

4. **All OCR inserts go through a single Postgres RPC** (`apply_ocr_result`) — atomic, all-or-nothing.

5. **Google Vision API key lives only in Supabase Edge Function env vars** — zero browser exposure. This is critical and non-negotiable.

6. **Multi-tenant from day one** — every table has `owner_id`. Each business owner sees only their data via Row Level Security.

7. **Multi-store from day one** — every table has `store_id`. Store switcher in the UI is a simple dropdown.

8. **Joint / Separate accounting toggle** — stored on the `stores` table as `accounting_view: 'joint' | 'separate'`. Joint mode aggregates across both stores, separate mode scopes to one store.

9. **Manual entry first, OCR second** — onboarding collects initial balances manually. After that, OCR handles everything automatically.

10. **Cash accounts are flexible** — can have unlimited accounts per store (till, bank accounts). Balances update automatically via Postgres triggers on every sale, expense, and transfer.

---

## Database Schema

### Tables

#### `owners`
The tenant. One row per business owner (client or future SaaS customer).
```
id, name, email, created_at
```

#### `stores`
One owner can have multiple stores.
```
id, owner_id, name, currency (default ETB), accounting_view ('separate'|'joint'), created_at
```

#### `cash_accounts`
Physical till or bank accounts. Unlimited per store.
```
id, store_id, name, account_type ('till'|'bank'), balance, created_at
```

#### `inventory_items`
```
id, store_id, item_name, sku, category, quantity (CHECK >= 0), unit_cost,
selling_price, low_stock_threshold, supplier, extra_fields (jsonb), created_at, updated_at
```

#### `stock_movements` (ledger)
```
id, store_id, item_id, movement_type ('in'|'out'|'adjustment'|'loss'),
quantity, unit_cost, source ('manual'|'ocr'|'sale'), reference_id, notes, created_at
```

#### `sales`
```
id, store_id, cash_account_id, sale_date, payment_method, total_amount,
source ('manual'|'ocr'), ocr_log_id, notes, created_at
```

#### `sale_items`
```
id, sale_id, item_id, item_name_snapshot, quantity, unit_price,
subtotal (GENERATED as quantity * unit_price)
```

#### `expenses`
```
id, store_id, cash_account_id, expense_date, amount, category, description,
source ('manual'|'ocr'), receipt_url, ocr_log_id, extra_fields (jsonb), notes, created_at
```

#### `cash_transfers`
Move money between till and bank accounts.
```
id, store_id, from_account_id, to_account_id, amount, notes, created_at
```

#### `ocr_logs`
Every scan is logged here before being applied.
```
id, store_id, image_url, document_type, raw_text, raw_blocks (jsonb),
parsed_data (jsonb), user_edited_data (jsonb),
status ('pending'|'reviewed'|'applied'|'discarded'),
destination_table, applied_record_ids (uuid[]), created_at
```

### Triggers
- `update_updated_at()` — fires on `inventory_items` update
- `apply_stock_movement()` — fires after insert on `stock_movements`, updates `inventory_items.quantity`
- `apply_sale_to_cash()` — fires after insert on `sales`, increments `cash_accounts.balance`
- `apply_expense_to_cash()` — fires after insert on `expenses`, decrements `cash_accounts.balance`
- `apply_cash_transfer()` — fires after insert on `cash_transfers`, moves balance between accounts

### Security
- Row Level Security enabled on all tables
- Every query scoped to `owner_id` via RLS policies
- Google Vision API key only in Edge Function environment — never in client code

---

## Application Screens (7)

### 1. Onboarding (first login only)
- Store name
- Add cash accounts (till + bank accounts) with starting balances
- Simple form, one time only

### 2. Dashboard
- Store switcher dropdown (Store 1 / Store 2 / Joint view)
- Live cash positions per account (till, each bank account)
- Today's sales total
- Today's expenses total
- Low stock alerts
- Recent activity feed
- 7-day sparkline chart

### 3. Inventory
- Searchable / filterable table
- Stock badges (in stock / low / out)
- Stock in / out actions
- Add item modal
- Item detail slide-over
- CSV export

### 4. Transactions
- Unified ledger (sales + expenses + stock movements)
- Filter by type / date / category
- Daily totals
- New transaction flow

### 5. Expenses
- Quick add form
- Category chips
- Monthly breakdown
- Receipt attachment

### 6. OCR Scanner
- Drag and drop + camera capture
- Upload progress
- Recent scans history

### 7. OCR Review Editor
- Side by side: image + editable table
- Confidence heatmap (amber / red for low confidence cells)
- Add / remove rows and columns
- Column mapping dropdowns (map to DB fields)
- Destination selector (Inventory / Sale / Expense)
- Apply button → calls `apply_ocr_result()` RPC

### 8. Reports
- Date range picker
- Sales vs expenses chart
- Profit / loss summary
- Inventory value
- OCR history log

---

## OCR Pipeline (7 steps)

1. **Capture** — browser file input or `getUserMedia()` camera. Validate type and size (max 10MB)
2. **Compress** — canvas `toBlob()` to max 1200px / 80% quality before upload
3. **Upload** — to Supabase Storage (permanent receipt archive)
4. **Vision API call** — via Supabase Edge Function proxy (server-side only)
5. **Parse** — client-side regex / heuristic parser. Extracts line items, totals, dates, vendor. Stores raw blocks with confidence scores
6. **Review editor** — contenteditable HTML table. Confidence heatmap. sessionStorage autosave every 5 seconds
7. **Apply** — Supabase RPC `apply_ocr_result()` — atomic transaction. Updates `ocr_logs.status = 'applied'`

---

## Folder Structure

```
storeos/
├── index.html
├── vite.config.js
├── PROJECT.md              ← you are here
├── .env                    ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── supabase/
│   ├── schema.sql          ← full database schema
│   └── functions/
│       └── ocr-proxy/
│           └── index.ts    ← Google Vision Edge Function
├── src/
│   ├── main.js             ← app entry, router init
│   ├── router.js           ← History API router
│   ├── store.js            ← Zustand state (current store, user, etc.)
│   ├── supabase.js         ← Supabase client init
│   ├── styles/
│   │   ├── main.css        ← CSS variables, global styles
│   │   └── components.css  ← reusable component styles
│   ├── components/
│   │   ├── nav.js          ← sidebar navigation
│   │   ├── store-switcher.js
│   │   └── toast.js        ← notifications
│   └── pages/
│       ├── onboarding.js
│       ├── dashboard.js
│       ├── inventory.js
│       ├── transactions.js
│       ├── expenses.js
│       ├── ocr-scanner.js
│       ├── ocr-editor.js
│       └── reports.js
```

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| API key exposure | Edge Function proxy — key never in client |
| Negative stock | CHECK constraint + trigger validation |
| OCR accuracy | Tesseract.js fallback + always show raw text |
| Dynamic fields breaking reports | JSONB extra_fields |
| Large image on mobile | Compress via canvas before upload |
| OCR edits lost on close | sessionStorage autosave every 5s |
| Data mixing between tenants | RLS policies on every table |

---

## Build Order (2 weeks)

### Week 1 — Core System
- Day 1–2: Supabase setup, full schema, seed data, app shell
- Day 3: Inventory CRUD
- Day 4: Unified transactions engine
- Day 5: Expenses page
- Day 6–7: Dashboard — KPIs, cash positions, alerts, chart

### Week 2 — OCR + Launch
- Day 8–9: Edge Function (Vision proxy) + storage upload
- Day 10: OCR review editor UI
- Day 11: Column mapping + apply RPC
- Day 12–13: Reports + mobile responsive pass
- Day 14: Deploy to Vercel + handover

---

## Client Context

- **Client:** Single business owner, 2 stores, Ethiopia
- **Currency:** ETB (Ethiopian Birr)
- **Language:** English UI
- **Devices:** Mobile first, desktop supported
- **Starting point:** Manual notebooks and spreadsheets
- **Goal:** Replace manual records, scan receipts automatically, see live cash positions
- **Future:** Sell this as a SaaS to other store owners at 2,000–3,000 ETB/month

---

## Rules for Trae / AI Assistance

- Always scope queries to `store_id` and `owner_id`
- Never mutate `inventory_items.quantity` directly — always insert into `stock_movements`
- Never call Google Vision from the browser — always via Edge Function
- Keep the frontend simple — no unnecessary UI complexity
- Every new feature must work for both stores independently and jointly
- Check this file before making architectural decisions
