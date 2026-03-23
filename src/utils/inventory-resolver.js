/**
 * StoreOS Inventory Resolver
 * Checks sold items against inventory and returns resolution data
 */

import { supabase } from '../supabase.js'
import { fuzzyMatch } from './fuzzy.js'

/**
 * Check each sold item against inventory
 * Returns array of items needing resolution
 */
export async function checkSaleAgainstInventory(saleItems, storeId) {
    if (!saleItems?.length || !storeId) return []

    // Load all inventory items for this store
    const { data: inventory } = await supabase
        .from('inventory_items')
        .select('id, item_name, quantity, unit_cost, selling_price, category')
        .eq('store_id', storeId)

    if (!inventory) return []

    const needsResolution = []

    for (const soldItem of saleItems) {
        const soldName = (soldItem.item_name_snapshot || soldItem.name || '').trim()
        if (!soldName) continue

        // Check exact match first
        const exactMatch = inventory.find(inv =>
            inv.item_name.toLowerCase().trim() === soldName.toLowerCase()
        )

        if (exactMatch) {
            // Exact match found — already deducted by trigger, no resolution needed
            continue
        }

        // Check fuzzy matches
        const fuzzy = fuzzyMatch(soldName, inventory, { key: 'item_name', threshold: 0.55, limit: 10 })
        const fuzzyMatches = fuzzy.map(inv => ({
            ...inv,
            confidence: inv._score,
            matchType: 'fuzzy'
        }))

        needsResolution.push({
            soldItem,
            soldName,
            soldQty: Number(soldItem.quantity) || 1,
            soldPrice: Number(soldItem.unit_price) || 0,
            fuzzyMatches: fuzzyMatches.slice(0, 3), // top 3 matches
            decision: null, // 'skip' | 'match' | 'create'
            matchedItemId: null,
            totalQtyHad: null,
            unitCost: null,
            targetStoreId: storeId,
            updatePrice: null, // null | true | false — only for 'match' decision
        })
    }

    return needsResolution
}

/**
 * Apply resolution decisions to the database
 */
export async function applyResolutions(resolutions, saleId) {
    const results = { success: [], errors: [] }

    for (const res of resolutions) {
        try {
            if (res.decision === 'skip') {
                results.success.push({ name: res.soldName, action: 'skipped' })
                continue
            }

            if (res.decision === 'match') {
                // Deduct from existing inventory item
                await supabase.from('stock_movements').insert({
                    store_id: res.targetStoreId,
                    item_id: res.matchedItemId,
                    movement_type: 'out',
                    quantity: res.soldQty,
                    source: 'sale',
                    reference_id: saleId,
                    notes: `Resolved: matched from sale of "${res.soldName}"`,
                })

                // Optionally update selling price
                if (res.updatePrice === true && res.soldPrice > 0) {
                    await supabase
                        .from('inventory_items')
                        .update({ selling_price: res.soldPrice })
                        .eq('id', res.matchedItemId)
                }

                results.success.push({ name: res.soldName, action: 'matched and deducted' })
                continue
            }

            if (res.decision === 'create') {
                // Calculate starting quantity
                const totalHad = Number(res.totalQtyHad) || res.soldQty
                const remaining = Math.max(0, totalHad - res.soldQty)
                const unitCost = Number(res.unitCost) > 0
                    ? Number(res.unitCost)
                    : res.soldPrice  // fallback to selling price

                // Create inventory item with remaining qty
                const { data: newItem, error: createErr } = await supabase
                    .from('inventory_items')
                    .insert({
                        store_id: res.targetStoreId,
                        item_name: res.soldName,
                        quantity: remaining,
                        unit_cost: unitCost || null,
                        selling_price: res.soldPrice || null,
                        low_stock_threshold: 5,
                    })
                    .select('id')
                    .single()

                if (createErr) throw createErr

                // Record the sale movement for audit trail
                await supabase.from('stock_movements').insert({
                    store_id: res.targetStoreId,
                    item_id: newItem.id,
                    movement_type: 'in',
                    quantity: totalHad,
                    source: 'manual',
                    notes: `Initial stock set during sale resolution (had ${totalHad} before sale)`,
                })

                // Record the deduction
                await supabase.from('stock_movements').insert({
                    store_id: res.targetStoreId,
                    item_id: newItem.id,
                    movement_type: 'out',
                    quantity: res.soldQty,
                    source: 'sale',
                    reference_id: saleId,
                    notes: `Deducted from sale resolution`,
                })

                results.success.push({ name: res.soldName, action: `created with ${remaining} remaining` })
                continue
            }

        } catch (err) {
            console.error('Resolution error for', res.soldName, err)
            results.errors.push({ name: res.soldName, error: err.message })
        }
    }

    return results
}