import type { InvChange, InvListFilters, InvOpResult, InvPage, InvProduct, InvVariation, InventoryBackend } from '~~/shared/types/inventory'
import type { InvChangeOrigin } from '~~/shared/types/inventory'
import { dbConfigured, ensureSchema, sql } from './db'

/**
 * Helpers COMPARTIDOS por los dos adaptadores de inventario (mock y woo):
 * validación de precios/stock, recálculo de campos derivados del padre, filtros
 * + paginación sobre el snapshot y el registro de cambios (inventory_changes).
 * Viven aparte de inventoryStore.ts para que los adaptadores no importen el
 * selector (evita el ciclo store → adaptador → store).
 */

export interface WriteContext {
  origen: InvChangeOrigin
  autor?: string
}

export const STOCK_BAJO_UMBRAL = 5

// ---------- validación de valores (compartida) ----------
export class InvValidationError extends Error {}

/** Precio COP: entero ≥ 0 como texto (shape Woo). null/'' = sin precio. */
export function normalizePrice(v: string | number | null | undefined, campo: string): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v).trim().replace(/[$\s]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new InvValidationError(`${campo}: precio inválido "${v}" (entero en pesos, sin decimales)`)
  if (n > 50_000_000) throw new InvValidationError(`${campo}: precio fuera de rango "${v}"`)
  return String(n)
}

export function normalizeStock(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new InvValidationError(`stock inválido "${v}" (entero ≥ 0)`)
  if (n > 100_000) throw new InvValidationError(`stock fuera de rango "${v}"`)
  return n
}

export function validatePricePair(regular: string, sale: string): void {
  if (sale && !regular) throw new InvValidationError('sale_price sin regular_price')
  if (sale && regular && Number(sale) >= Number(regular)) throw new InvValidationError(`sale_price (${sale}) debe ser menor que regular_price (${regular})`)
}

// ---------- recálculo de campos derivados del padre (como hace Woo) ----------
export function recomputeProduct(p: InvProduct): InvProduct {
  if (p.type !== 'variable' || !p.variations.length) return p
  const prices = p.variations.map(v => Number(v.price)).filter(n => Number.isFinite(n) && n > 0)
  const price = prices.length ? String(Math.min(...prices)) : ''
  const anyIn = p.variations.some(v => v.stock_status === 'instock')
  return { ...p, price, stock_status: anyIn ? 'instock' : (p.variations.some(v => v.stock_status === 'onbackorder') ? 'onbackorder' : 'outofstock') }
}

/** Estado de stock de una variación según Woo: gestionada → por cantidad. */
export function stockStatusFor(v: Pick<InvVariation, 'manage_stock' | 'stock_quantity' | 'stock_status'>): InvVariation['stock_status'] {
  if (!v.manage_stock) return v.stock_status === 'outofstock' ? 'outofstock' : 'instock'
  return (v.stock_quantity ?? 0) > 0 ? 'instock' : 'outofstock'
}

// ---------- filtros + paginación (compartidos: ambos adaptadores leen el snapshot) ----------
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function variationStockKind(v: InvVariation): 'sin_gestion' | 'agotado' | 'bajo' | 'ok' {
  if (!v.manage_stock) return v.stock_status === 'outofstock' ? 'agotado' : 'sin_gestion'
  const q = v.stock_quantity ?? 0
  if (q <= 0) return 'agotado'
  if (q <= STOCK_BAJO_UMBRAL) return 'bajo'
  return 'ok'
}

export function applyFilters(products: InvProduct[], f: InvListFilters): InvPage<InvProduct> {
  let items = products
  const q = fold((f.q ?? '').trim())
  if (q) items = items.filter(p => fold(p.name).includes(q) || fold(p.sku).includes(q) || p.variations.some(v => fold(v.sku).includes(q)))
  if (f.status && f.status !== 'any') items = items.filter(p => p.status === f.status)
  if (f.grupo) items = items.filter(p => p.kustom.grupo === f.grupo)
  if (f.publico) items = items.filter(p => p.kustom.publicos.includes(f.publico as string))
  if (f.stock && f.stock !== 'any') {
    items = items.filter((p) => {
      const kinds = p.variations.map(variationStockKind)
      if (f.stock === 'agotado') return kinds.length ? kinds.every(k => k === 'agotado') || kinds.some(k => k === 'agotado') : false
      if (f.stock === 'bajo') return kinds.some(k => k === 'bajo' || k === 'agotado')
      return kinds.every(k => k === 'sin_gestion')
    })
  }
  const dir = f.order === 'desc' ? -1 : 1
  const by = f.orderby ?? 'sku'
  const stockOf = (p: InvProduct) => p.variations.reduce((s, v) => s + (v.manage_stock ? (v.stock_quantity ?? 0) : 0), 0)
  items = [...items].sort((a, b) => {
    let d = 0
    if (by === 'name') d = a.name.localeCompare(b.name, 'es')
    else if (by === 'price') d = (Number(a.price) || 0) - (Number(b.price) || 0)
    else if (by === 'stock') d = stockOf(a) - stockOf(b)
    else if (by === 'modified') d = String(a.date_modified ?? '').localeCompare(String(b.date_modified ?? ''))
    if (d === 0) d = a.sku.localeCompare(b.sku)
    return d * dir
  })
  const per_page = Math.min(Math.max(Number(f.per_page) || 25, 1), 100)
  const total = items.length
  const total_pages = Math.max(1, Math.ceil(total / per_page))
  const page = Math.min(Math.max(Number(f.page) || 1, 1), total_pages)
  return { items: items.slice((page - 1) * per_page, page * per_page), total, page, per_page, total_pages }
}

// ---------- registro de cambios (ambos adaptadores) ----------
const memoryChanges: InvChange[] = []
let memoryId = 1

async function dbReady(): Promise<boolean> {
  if (!dbConfigured()) return false
  try {
    await ensureSchema()
    return true
  }
  catch {
    return false
  }
}

const LOGGED_FIELDS: (keyof InvVariation)[] = ['regular_price', 'sale_price', 'manage_stock', 'stock_quantity']

/** Una fila por campo que cambió. Devuelve cuántas filas se escribieron. */
export async function logChanges(backend: InventoryBackend, sku: string, before: Partial<InvVariation>, after: Partial<InvVariation>, ctx: WriteContext): Promise<number> {
  const rows: Omit<InvChange, 'id' | 'created_at'>[] = []
  for (const campo of LOGGED_FIELDS) {
    const a = before[campo], b = after[campo]
    if (b === undefined) continue
    const as = a === undefined || a === null ? null : String(a)
    const bs = b === null ? null : String(b)
    if (as === bs) continue
    rows.push({ backend, sku, campo, anterior: as, nuevo: bs, origen: ctx.origen, autor: ctx.autor ?? null })
  }
  if (!rows.length) return 0
  if (await dbReady()) {
    const q = sql()
    for (const r of rows) {
      await q.query(
        `INSERT INTO inventory_changes (backend, sku, campo, anterior, nuevo, origen, autor) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.backend, r.sku, r.campo, r.anterior, r.nuevo, r.origen, r.autor],
      )
    }
  }
  else {
    for (const r of rows) memoryChanges.unshift({ ...r, id: memoryId++, created_at: new Date().toISOString() })
  }
  return rows.length
}

export async function listChanges(opts: { sku?: string, page?: number, per_page?: number } = {}): Promise<InvPage<InvChange>> {
  const per_page = Math.min(Math.max(Number(opts.per_page) || 50, 1), 200)
  const page = Math.max(Number(opts.page) || 1, 1)
  const sku = (opts.sku ?? '').trim()
  if (await dbReady()) {
    const where = sku ? `WHERE sku = $1 OR sku LIKE $1 || '-T%'` : ''
    const params: unknown[] = sku ? [sku] : []
    const total = Number((await sql().query(`SELECT count(*)::int AS c FROM inventory_changes ${where}`, params) as any[])[0]?.c ?? 0)
    const rows = await sql().query(
      `SELECT * FROM inventory_changes ${where} ORDER BY id DESC LIMIT ${per_page} OFFSET ${(page - 1) * per_page}`,
      params,
    ) as any[]
    return {
      items: rows.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
      total, page, per_page, total_pages: Math.max(1, Math.ceil(total / per_page)),
    }
  }
  const all = sku ? memoryChanges.filter(c => c.sku === sku || c.sku.startsWith(`${sku}-T`)) : memoryChanges
  return { items: all.slice((page - 1) * per_page, page * per_page), total: all.length, page, per_page, total_pages: Math.max(1, Math.ceil(all.length / per_page)) }
}

