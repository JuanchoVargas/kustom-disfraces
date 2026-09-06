import type { InvListFilters, InvOpResult, InvOperation, InvPage, InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { InventoryStore } from './inventoryStore'
import type { WriteContext } from './inventoryCommon'
import {
  InvValidationError, applyFilters, logChanges, normalizePrice, normalizeStock, recomputeProduct, stockStatusFor, validatePricePair,
} from './inventoryCommon'
import { loadInventory, loadProductBySku } from './inventorySnapshot'
import { dbConfigured, ensureSchema, sql } from './db'

/**
 * ADAPTADOR MOCK (modo simulación). Lee productos REALES (snapshot de Woo con la
 * llave de solo lectura; catalogo.json si no hay snapshot) y simula las
 * escrituras guardándolas en `inventory_overrides` (Postgres; Map en memoria si
 * no hay BD). Al leer, las sobreescrituras se aplican encima de lo que trae Woo,
 * así el panel ve sus cambios persistidos durante el desarrollo.
 *
 * Los cambios NO llegan a Woo ni al sitio público. El día del cambio de
 * adaptador se aplican con /api/inventario/aplicar-woo (vista previa + aplicar).
 */

export interface Override {
  sku: string
  regular_price: string | null
  sale_price: string | null
  manage_stock: boolean | null
  stock_quantity: number | null
  updated_at: string
  updated_by: string | null
}

const memory = new Map<string, Override>()

async function dbReady(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch (err) {
    console.error('[inventario-mock] BD no disponible — overrides en memoria:', String((err as Error)?.message ?? err))
    return false
  }
}

export async function getOverrides(): Promise<Map<string, Override>> {
  if (await dbReady()) {
    const rows = await sql().query(`SELECT * FROM inventory_overrides`) as any[]
    return new Map(rows.map(r => [r.sku, { ...r, updated_at: new Date(r.updated_at).toISOString() }]))
  }
  return new Map(memory)
}

export async function countOverrides(): Promise<number> {
  if (await dbReady()) {
    const rows = await sql().query(`SELECT count(*)::int AS c FROM inventory_overrides`) as any[]
    return Number(rows[0]?.c ?? 0)
  }
  return memory.size
}

async function setOverride(sku: string, patch: Partial<Omit<Override, 'sku' | 'updated_at'>>): Promise<Override> {
  const prev = (await getOverrides()).get(sku)
  const next: Override = {
    sku,
    regular_price: patch.regular_price !== undefined ? patch.regular_price : prev?.regular_price ?? null,
    sale_price: patch.sale_price !== undefined ? patch.sale_price : prev?.sale_price ?? null,
    manage_stock: patch.manage_stock !== undefined ? patch.manage_stock : prev?.manage_stock ?? null,
    stock_quantity: patch.stock_quantity !== undefined ? patch.stock_quantity : prev?.stock_quantity ?? null,
    updated_at: new Date().toISOString(),
    updated_by: patch.updated_by ?? prev?.updated_by ?? null,
  }
  memory.set(sku, next)
  if (await dbReady()) {
    await sql().query(
      `INSERT INTO inventory_overrides (sku, regular_price, sale_price, manage_stock, stock_quantity, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sku) DO UPDATE SET regular_price = EXCLUDED.regular_price, sale_price = EXCLUDED.sale_price,
         manage_stock = EXCLUDED.manage_stock, stock_quantity = EXCLUDED.stock_quantity,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [next.sku, next.regular_price, next.sale_price, next.manage_stock, next.stock_quantity, next.updated_at, next.updated_by],
    )
  }
  return next
}

/** Quita sobreescrituras (tras aplicarlas a Woo con éxito). */
export async function deleteOverrides(skus: string[]): Promise<void> {
  for (const s of skus) memory.delete(s)
  if (!skus.length || !await dbReady()) return
  await sql().query(`DELETE FROM inventory_overrides WHERE sku = ANY($1::text[])`, [skus])
}

/** Variación con la sobreescritura aplicada (shape Woo intacto). */
export function applyOverride(v: InvVariation, o: Override | undefined): InvVariation {
  if (!o) return v
  const regular = o.regular_price ?? v.regular_price
  const sale = o.sale_price ?? v.sale_price
  const manage = o.manage_stock ?? v.manage_stock
  const qty = manage ? (o.stock_quantity ?? v.stock_quantity ?? 0) : (o.stock_quantity ?? v.stock_quantity)
  const next: InvVariation = { ...v, regular_price: regular, sale_price: sale, price: sale || regular, manage_stock: manage, stock_quantity: qty }
  next.stock_status = stockStatusFor(next)
  if (o.updated_at && (!v.date_modified || o.updated_at > v.date_modified)) next.date_modified = o.updated_at
  return next
}

export function applyOverridesToProduct(p: InvProduct, overrides: Map<string, Override>): InvProduct {
  if (!p.variations.some(v => overrides.has(v.sku))) return p
  return recomputeProduct({ ...p, variations: p.variations.map(v => applyOverride(v, overrides.get(v.sku))) })
}

const pick = (v: InvVariation): Partial<InvVariation> => ({
  regular_price: v.regular_price, sale_price: v.sale_price, price: v.price, manage_stock: v.manage_stock, stock_quantity: v.stock_quantity, stock_status: v.stock_status,
})

export function createMockStore(): InventoryStore {
  async function currentVariation(sku: string): Promise<InvVariation | null> {
    const p = await loadProductBySku(sku)
    if (!p) return null
    const v = p.variations.find(x => x.sku === sku)
    if (!v) return null
    return applyOverride(v, (await getOverrides()).get(sku))
  }

  async function applyOne(op: InvOperation, ctx: WriteContext): Promise<InvOpResult> {
    try {
      const before = await currentVariation(op.sku)
      if (!before) return { sku: op.sku, ok: false, error: 'SKU de variación inexistente' }
      let after: InvVariation
      if (op.op === 'price') {
        const regular = normalizePrice(op.regular_price, 'regular_price')
        const sale = normalizePrice(op.sale_price, 'sale_price')
        validatePricePair(regular, sale)
        const o = await setOverride(op.sku, { regular_price: regular, sale_price: sale, updated_by: ctx.autor ?? ctx.origen })
        after = applyOverride(before, o)
      }
      else {
        const qty = normalizeStock(op.stock_quantity)
        const o = await setOverride(op.sku, { manage_stock: op.manage_stock ?? true, stock_quantity: qty, updated_by: ctx.autor ?? ctx.origen })
        after = applyOverride(before, o)
      }
      await logChanges('mock', op.sku, pick(before), pick(after), ctx)
      return { sku: op.sku, ok: true, before: pick(before), after: pick(after) }
    }
    catch (err) {
      const msg = err instanceof InvValidationError ? err.message : `error: ${String((err as Error)?.message ?? err)}`
      return { sku: op.sku, ok: false, error: msg }
    }
  }

  return {
    backend: 'mock',
    simulation: true,

    async listProducts(filters: InvListFilters): Promise<InvPage<InvProduct>> {
      const [{ products }, overrides] = await Promise.all([loadInventory(), getOverrides()])
      return applyFilters(products.map(p => applyOverridesToProduct(p, overrides)), filters)
    },

    async getProduct(sku: string): Promise<InvProduct | null> {
      const p = await loadProductBySku(sku)
      return p ? applyOverridesToProduct(p, await getOverrides()) : null
    },

    updateVariationPrice(skuTalla, regularPrice, salePrice, ctx) {
      return applyOne({ op: 'price', sku: skuTalla, regular_price: regularPrice, sale_price: salePrice }, ctx)
    },

    updateVariationStock(skuTalla, quantity, ctx) {
      return applyOne({ op: 'stock', sku: skuTalla, stock_quantity: quantity, manage_stock: true }, ctx)
    },

    async bulkUpdate(operations, ctx) {
      const out: InvOpResult[] = []
      for (const op of operations) out.push(await applyOne(op, ctx))
      return out
    },

    async ping() {
      const load = await loadInventory()
      const db = dbConfigured()
      if (load.origen === 'woo') return { ok: true, detail: `simulación · datos reales de Woo (snapshot de ${load.products.length} productos)${db ? '' : ' · sin BD: cambios en memoria'}` }
      return { ok: true, detail: `simulación · catalogo.json (sin snapshot de Woo: pulsa "Sincronizar")${db ? '' : ' · sin BD: cambios en memoria'}` }
    },
  }
}
