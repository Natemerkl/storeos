import { supabase } from '../supabase.js'
import { appStore } from '../store.js'

// ── Core log function ─────────────────────────────────────────
export async function auditLog({
  action,
  entityType,
  entityId    = null,
  entityLabel = null,
  oldData     = null,
  newData     = null,
  meta        = {},
}) {
  try {
    const { currentStore, user } = appStore.getState()

    await supabase.from('audit_logs').insert({
      store_id:     currentStore?.id || null,
      user_email:   user?.email      || 'unknown',
      user_name:    user?.email?.split('@')[0] || 'unknown',
      action,
      entity_type:  entityType,
      entity_id:    entityId,
      entity_label: entityLabel,
      old_data:     oldData,
      new_data:     newData,
      meta,
      created_at:   new Date().toISOString(),
    })
  } catch(err) {
    // Never let audit logging break the main flow
    console.warn('Audit log failed:', err.message)
  }
}

// ── Convenience wrappers ──────────────────────────────────────
export const audit = {
  // Sales
  salecompleted: (sale, items) => auditLog({
    action:      'complete_sale',
    entityType:  'sale',
    entityId:    sale.id,
    entityLabel: `Sale — ${Number(sale.total_amount).toLocaleString()} ETB`,
    newData:     { ...sale, items },
    meta:        { itemCount: items?.length, paymentMethod: sale.payment_method },
  }),

  saleDeleted: (sale) => auditLog({
    action:      'delete',
    entityType:  'sale',
    entityId:    sale.id,
    entityLabel: `Sale — ${Number(sale.total_amount).toLocaleString()} ETB`,
    oldData:     sale,
  }),

  // Expenses
  expenseCreated: (expense) => auditLog({
    action:      'create',
    entityType:  'expense',
    entityId:    expense.id,
    entityLabel: `${expense.category || 'Expense'} — ${Number(expense.amount).toLocaleString()} ETB`,
    newData:     expense,
  }),

  expenseUpdated: (oldExp, newExp) => auditLog({
    action:      'update',
    entityType:  'expense',
    entityId:    newExp.id,
    entityLabel: `${newExp.category || 'Expense'} — ${Number(newExp.amount).toLocaleString()} ETB`,
    oldData:     oldExp,
    newData:     newExp,
  }),

  expenseDeleted: (expense) => auditLog({
    action:      'delete',
    entityType:  'expense',
    entityId:    expense.id,
    entityLabel: `${expense.category || 'Expense'} — ${Number(expense.amount).toLocaleString()} ETB`,
    oldData:     expense,
  }),

  // Inventory
  itemCreated: (item) => auditLog({
    action:      'create',
    entityType:  'inventory_item',
    entityId:    item.id,
    entityLabel: item.item_name,
    newData:     item,
  }),

  itemUpdated: (oldItem, newItem) => auditLog({
    action:      'update',
    entityType:  'inventory_item',
    entityId:    newItem.id,
    entityLabel: newItem.item_name,
    oldData:     oldItem,
    newData:     newItem,
  }),

  itemDeleted: (item) => auditLog({
    action:      'delete',
    entityType:  'inventory_item',
    entityId:    item.id,
    entityLabel: item.item_name,
    oldData:     item,
  }),

  stockMoved: (movement, itemName) => auditLog({
    action:      'stock_movement',
    entityType:  'stock_movement',
    entityId:    movement.id,
    entityLabel: `${movement.movement_type.toUpperCase()} ${movement.quantity} × ${itemName}`,
    newData:     movement,
    meta:        { type: movement.movement_type, qty: movement.quantity },
  }),

  // Cash
  transferCreated: (transfer, fromName, toName) => auditLog({
    action:      'create',
    entityType:  'cash_transfer',
    entityId:    transfer.id,
    entityLabel: `Transfer ${Number(transfer.amount).toLocaleString()} ETB — ${fromName} → ${toName}`,
    newData:     transfer,
    meta:        { fromName, toName, amount: transfer.amount },
  }),

  // Credit
  creditPaymentReceived: (credit, amount, customerName) => auditLog({
    action:      'payment_received',
    entityType:  'credit_sale',
    entityId:    credit.id,
    entityLabel: `Payment from ${customerName} — ${Number(amount).toLocaleString()} ETB`,
    newData:     { ...credit, paymentReceived: amount },
    meta:        { customerName, amount },
  }),

  vendorPaymentMade: (debt, amount, vendorName) => auditLog({
    action:      'payment_received',
    entityType:  'vendor_debt',
    entityId:    debt.id,
    entityLabel: `Payment to ${vendorName} — ${Number(amount).toLocaleString()} ETB`,
    newData:     { ...debt, paymentMade: amount },
    meta:        { vendorName, amount },
  }),

  // OCR
  ocrApplied: (log, destination) => auditLog({
    action:      'apply_ocr',
    entityType:  'ocr_log',
    entityId:    log.id,
    entityLabel: `OCR scan applied to ${destination}`,
    newData:     { status: 'applied', destination },
    meta:        { destination },
  }),

  // Auth
  login: () => auditLog({
    action:      'login',
    entityType:  'auth',
    entityLabel: 'User signed in',
    meta:        { timestamp: new Date().toISOString() },
  }),

  logout: () => auditLog({
    action:      'logout',
    entityType:  'auth',
    entityLabel: 'User signed out',
    meta:        { timestamp: new Date().toISOString() },
  }),

  // Export
  dataExported: (type, recordCount) => auditLog({
    action:      'export',
    entityType:  'export',
    entityLabel: `Exported ${recordCount} ${type} records`,
    meta:        { type, recordCount },
  }),
}