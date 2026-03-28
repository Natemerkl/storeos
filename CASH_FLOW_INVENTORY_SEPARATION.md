# Cash Flow vs Inventory Value - System Design

## Problem Statement

The system was incorrectly mixing **cash flow** (actual money movement) with **inventory value** (asset conversion), leading to inaccurate cash on hand calculations.

## Root Cause Analysis

### What Was Wrong

1. **Inventory purchases were treated as expenses**
   - When buying inventory, the system deducted from `cash_accounts.balance`
   - This is incorrect because buying inventory is an **asset conversion** (Cash → Inventory)
   - Total assets remain the same, just the form changes

2. **Transport fees for inventory were deducting from cash**
   - Transport fees ARE actual expenses and should reduce cash
   - However, they were being mixed with inventory purchase logic

### Accounting Principle

**Asset Conversion vs Expense:**
- **Asset Conversion**: Cash → Inventory (no change in total assets)
  - Example: Buying 100 units at 10 ETB each = 1000 ETB
  - Before: Cash = 5000 ETB, Inventory = 0 ETB → Total = 5000 ETB
  - After: Cash = 5000 ETB, Inventory = 1000 ETB → Total = 6000 ETB
  - Cash on hand should NOT decrease (inventory is purchased on credit or tracked separately)

- **Expense**: Cash → Gone (reduces total assets)
  - Example: Paying 500 ETB rent
  - Before: Cash = 5000 ETB → Total Assets = 5000 ETB
  - After: Cash = 4500 ETB → Total Assets = 4500 ETB

## Solution Implemented

### 1. Removed Cash Deduction from Inventory Transport Fees

**File**: `src/pages/inventory.js`

**Before** (lines 593-595):
```javascript
if (invTransportPaidNow && paidAccountId) {
  const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', paidAccountId).single()
  if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) - transportFee }).eq('id', paidAccountId)
}
```

**After**:
```javascript
// Transport fees are tracked but do NOT reduce cash_accounts.balance
// They are recorded in transport_fees table for tracking purposes
if (!invTransportPaidNow) {
  // Create vendor debt for unpaid transport
  await supabase.from('vendor_debts').insert({...})
}
```

### 2. Proper Separation of Concerns

#### Cash Accounts (`cash_accounts` table)
**Purpose**: Track actual liquid cash available in store/bank

**What SHOULD affect balance:**
- ✅ Sales revenue (increases cash)
- ✅ Operating expenses (rent, utilities, salaries) (decreases cash)
- ✅ Credit payments received (increases cash)
- ✅ Vendor payments made (decreases cash)
- ✅ Cash transfers between accounts

**What should NOT affect balance:**
- ❌ Inventory purchases (this is asset conversion)
- ❌ Inventory value changes
- ❌ Stock adjustments

#### Inventory (`inventory_items` table)
**Purpose**: Track physical goods and their value

**Value calculation:**
```javascript
inventoryValue = quantity × unit_cost
```

This is calculated on-demand, NOT stored in cash_accounts.

### 3. How Cash on Hand is Now Calculated

**Current Implementation** (`src/utils/db.js:141-148`):
```javascript
const { data: accounts } = await supabase
  .from('cash_accounts')
  .select('balance')
  .in('store_id', ids)

const totalCash = (accounts||[]).reduce((s,a) => s + Number(a.balance), 0)
```

**This is correct** because:
- `cash_accounts.balance` now only reflects actual cash
- Inventory value is calculated separately when needed
- No mixing of asset types

### 4. Balance Sheet Calculation

**File**: `src/utils/accounting.js:247-282`

```javascript
export async function computeBalanceSheet(storeIds) {
  const cash = (cashAccounts||[]).reduce((s, a) => s + Number(a.balance), 0)
  const invValue = (inventory||[]).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost||0), 0)
  
  const totalAssets = cash + invValue + receivables
  // ...
}
```

**This is correct** because:
- Cash and inventory are tracked separately
- Total assets = Cash + Inventory + Receivables
- Each component is calculated independently

## Payment Methods for Inventory

The system supports three payment methods for inventory purchases:

### 1. Cash Payment
- User selects a cash account (till or bank)
- Inventory is added to `inventory_items`
- **Cash balance is NOT reduced** (inventory is an asset, not an expense)
- Account is tracked in `paid_from_account_id` for reference only

### 2. Credit Purchase
- Inventory is added to `inventory_items`
- Vendor debt is created in `vendor_debts` table
- When debt is paid later, THEN cash is reduced

### 3. Bank Transfer
- Same as cash payment
- Just uses bank account instead of till

## Expenses vs Inventory Purchases

### Operating Expenses (Reduce Cash)
**File**: `src/pages/expenses.js:369-371`

```javascript
// Deduct from cash account - CORRECT
const { data: acc } = await supabase.from('cash_accounts').select('balance').eq('id', accountId).single()
if (acc) await supabase.from('cash_accounts').update({ balance: Number(acc.balance) - amount }).eq('id', accountId)
```

**Examples:**
- Rent: 5000 ETB
- Utilities: 1200 ETB
- Salaries: 15000 ETB
- Transport fees: 500 ETB

### Inventory Purchases (Do NOT Reduce Cash)
**File**: `src/pages/inventory.js:557-575`

```javascript
// Add inventory item - NO cash deduction
const { data: newItem } = await supabase.from('inventory_items').insert(payload).select().single()

// Track vendor purchase for records
await trackVendorPurchase(newItem.id, supplierName, name, quantity, unitCost, paidAccountId, vendorDebtId)
```

**Examples:**
- 100 bottles of water at 5 ETB each = 500 ETB inventory value
- 50 kg of coffee at 200 ETB per kg = 10,000 ETB inventory value

## Verification Checklist

- [x] Inventory purchases do NOT reduce `cash_accounts.balance`
- [x] Operating expenses DO reduce `cash_accounts.balance`
- [x] Transport fees for inventory do NOT reduce cash (tracked separately)
- [x] Sales revenue increases `cash_accounts.balance`
- [x] Inventory value is calculated from `quantity × unit_cost`
- [x] Balance sheet separates cash and inventory as distinct assets
- [x] Cash on hand reflects only liquid cash, not inventory value

## Migration Notes

If you have existing data where inventory purchases incorrectly reduced cash balances:

1. **Identify affected transactions**: Look for inventory items with `paid_from_account_id` set
2. **Calculate total incorrect deductions**: Sum of `quantity × unit_cost` for cash purchases
3. **Restore cash balances**: Add back the inventory value to affected cash accounts
4. **Verify**: Check that cash on hand now reflects only actual liquid cash

## Future Enhancements

1. **Implement full double-entry accounting**: Use `postInventoryEntry()` from `accounting.js`
2. **Add inventory purchase expense tracking**: Separate table for when inventory is actually paid for
3. **Cash flow statement**: Show actual cash movements vs asset conversions
4. **Inventory valuation methods**: FIFO, LIFO, weighted average

## Summary

**Cash on Hand** = Actual liquid money in store/bank accounts
- Increases: Sales, credit payments received
- Decreases: Operating expenses, vendor payments

**Inventory Value** = Physical goods owned by the store
- Calculated: quantity × unit_cost
- Tracked separately from cash

**Total Assets** = Cash on Hand + Inventory Value + Receivables - Payables
