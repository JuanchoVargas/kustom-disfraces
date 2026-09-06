import type { InvListFilters, InvOperation, InvProduct, InvVariation } from '~~/shared/types/inventory'
import type { Cell } from './xlsxLite'
import { InvValidationError, applyFilters, normalizePrice, normalizeStock, stockStatusFor, validatePricePair } from './inventoryCommon'
import { tallaFromSku } from '~~/shared/utils/tallas'

/**
 * OPERACIONES MASIVAS e IMPORTACIÓN: calculan la vista previa "antes → después"
 * por variación (talla) SIN escribir. El panel muestra la previsualización y,
 * al confirmar, envía las operaciones resultantes a /api/inventario/operaciones
 * (origen 'masivo' o 'importacion'), que las ejecuta por el adaptador activo.
 */

// ---------- filas de vista previa ----------
export interface PreviewRow {
  sku: string
  producto: string
  codigo: string
  talla: string
  status: InvProduct['status']
  antes: Snap
  despues: Snap
  ops: InvOperation[]
  /** vacío = sin cambio real */
  cambia: boolean
  error?: string
}
export interface Snap { regular_price: string, sale_price: string, manage_stock: boolean, stock_quantity: number | null, stock_status: string }
const snap = (v: InvVariation): Snap => ({ regular_price: v.regular_price, sale_price: v.sale_price, manage_stock: v.manage_stock, stock_quantity: v.stock_quantity, stock_status: v.stock_status })
export const tallaDe = (v: InvVariation) => String(v.attributes.find(a => a.name === 'Talla')?.option ?? tallaFromSku(v.sku) ?? '?')

/** Aplica cambios de precio/stock a una copia de la variación (misma lógica que el mock). */
function apply(v: InvVariation, next: { regular?: string, sale?: string, stock?: number, manage?: boolean }): InvVariation {
  const regular = next.regular ?? v.regular_price
  const sale = next.sale ?? v.sale_price
  const manage = next.manage ?? (next.stock !== undefined ? true : v.manage_stock)
  const qty = next.stock !== undefined ? next.stock : v.stock_quantity
  const out: InvVariation = { ...v, regular_price: regular, sale_price: sale, price: sale || regular, manage_stock: manage, stock_quantity: qty }
  out.stock_status = stockStatusFor(out)
  return out
}

function rowFor(p: InvProduct, v: InvVariation, next: { regular?: string, sale?: string, stock?: number, manage?: boolean }, error?: string): PreviewRow {
  const after = error ? v : apply(v, next)
  const ops: InvOperation[] = []
  if (!error) {
    if (after.regular_price !== v.regular_price || after.sale_price !== v.sale_price) ops.push({ op: 'price', sku: v.sku, regular_price: after.regular_price, sale_price: after.sale_price })
    if (after.manage_stock !== v.manage_stock || after.stock_quantity !== v.stock_quantity) ops.push({ op: 'stock', sku: v.sku, stock_quantity: after.stock_quantity ?? 0, manage_stock: after.manage_stock })
  }
  return { sku: v.sku, producto: p.name, codigo: p.sku, talla: tallaDe(v), status: p.status, antes: snap(v), despues: snap(after), ops, cambia: ops.length > 0, error }
}

// ---------- operación masiva ----------
export interface BulkSpec {
  /** SKUs de producto seleccionados; si viene vacío se usan los filtros */
  skus?: string[]
  filtros?: InvListFilters
  /** solo estas tallas (vacío = todas) */
  tallas?: string[]
  precio?: { modo: 'fijar' | 'porcentaje' | 'monto', valor: number, redondeo?: number }
  oferta?: { modo: 'fijar' | 'porcentaje' | 'quitar', valor?: number }
  stock?: { modo: 'fijar' | 'sumar' | 'agotar' | 'gestionar', valor?: number }
}

const roundTo = (n: number, step: number) => (step > 1 ? Math.round(n / step) * step : Math.round(n))

export function bulkPreview(products: InvProduct[], spec: BulkSpec): { filas: PreviewRow[], productos: number } {
  let targets = products
  if (spec.skus?.length) { const set = new Set(spec.skus); targets = products.filter(p => set.has(p.sku)) }
  else if (spec.filtros) targets = allMatching(products, spec.filtros)
  const tallas = new Set((spec.tallas ?? []).map(String))
  const filas: PreviewRow[] = []
  for (const p of targets) {
    for (const v of p.variations) {
      if (tallas.size && !tallas.has(tallaDe(v))) continue
      try {
        const next: { regular?: string, sale?: string, stock?: number, manage?: boolean } = {}
        const curRegular = Number(v.regular_price) || 0
        if (spec.precio) {
          const val = Number(spec.precio.valor)
          if (!Number.isFinite(val)) throw new InvValidationError('precio: valor inválido')
          let n: number
          if (spec.precio.modo === 'fijar') n = val
          else if (spec.precio.modo === 'porcentaje') { if (!curRegular) throw new InvValidationError('sin precio actual: no se puede aplicar %'); n = roundTo(curRegular * (1 + val / 100), spec.precio.redondeo ?? 100) }
          else { if (!curRegular) throw new InvValidationError('sin precio actual: no se puede sumar un monto'); n = curRegular + val }
          next.regular = normalizePrice(n, 'precio')
        }
        if (spec.oferta) {
          const baseRegular = Number(next.regular ?? v.regular_price) || 0
          if (spec.oferta.modo === 'quitar') next.sale = ''
          else {
            const val = Number(spec.oferta.valor)
            if (!Number.isFinite(val)) throw new InvValidationError('oferta: valor inválido')
            if (spec.oferta.modo === 'fijar') next.sale = normalizePrice(val, 'precio rebajado')
            else { if (!baseRegular) throw new InvValidationError('sin precio normal: no se puede calcular la oferta'); next.sale = normalizePrice(roundTo(baseRegular * (1 - val / 100), 100), 'precio rebajado') }
          }
        }
        if (next.regular !== undefined || next.sale !== undefined) validatePricePair(next.regular ?? v.regular_price, next.sale ?? v.sale_price)
        if (spec.stock) {
          if (spec.stock.modo === 'agotar') next.stock = 0
          else if (spec.stock.modo === 'gestionar') { next.manage = true; next.stock = v.manage_stock ? (v.stock_quantity ?? 0) : normalizeStock(spec.stock.valor ?? 0) }
          else if (spec.stock.modo === 'fijar') next.stock = normalizeStock(spec.stock.valor)
          else next.stock = normalizeStock((v.manage_stock ? (v.stock_quantity ?? 0) : 0) + Number(spec.stock.valor ?? 0))
        }
        filas.push(rowFor(p, v, next))
      }
      catch (err) {
        filas.push(rowFor(p, v, {}, err instanceof InvValidationError ? err.message : String((err as Error)?.message ?? err)))
      }
    }
  }
  return { filas, productos: targets.length }
}
function allMatching(products: InvProduct[], f: InvListFilters): InvProduct[] {
  const out: InvProduct[] = []
  let page = 1
  for (;;) {
    const r = applyFilters(products, { ...f, page, per_page: 100 })
    out.push(...r.items)
    if (page >= r.total_pages) break
    page++
  }
  return out
}

// ---------- exportar ----------
export const EXPORT_HEADER = ['SKU', 'Código', 'Producto', 'Talla', 'Estado', 'Línea', 'Precio normal', 'Precio rebajado', 'Stock', 'Gestionar stock', 'Estado stock']
export const EXPORT_WIDTHS = [20, 14, 34, 8, 12, 16, 15, 16, 9, 15, 13]
const ESTADO_STOCK: Record<string, string> = { instock: 'disponible', outofstock: 'agotado', onbackorder: 'bajo pedido' }

export function exportRows(products: InvProduct[]): Cell[][] {
  const rows: Cell[][] = []
  for (const p of products) {
    for (const v of p.variations) {
      rows.push([
        v.sku, p.sku, p.name, tallaDe(v), p.status === 'publish' ? 'publicado' : 'borrador', p.kustom.grupo ?? '',
        v.regular_price ? Number(v.regular_price) : null,
        v.sale_price ? Number(v.sale_price) : null,
        v.manage_stock ? (v.stock_quantity ?? 0) : null,
        v.manage_stock ? 'sí' : 'no',
        ESTADO_STOCK[v.stock_status] ?? v.stock_status,
      ])
    }
  }
  return rows
}

// ---------- importar ----------
export interface ImportResult {
  columnas: { sku: boolean, precio: boolean, oferta: boolean, stock: boolean }
  filas: PreviewRow[]
  ignoradas: { fila: number, motivo: string }[]
  resumen: { total: number, con_cambios: number, sin_cambio: number, errores: number }
}
const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Lee las filas de una hoja (encabezado + datos). Columnas por nombre (sin
 * tildes, sin mayúsculas): "sku" obligatoria; "precio normal", "precio
 * rebajado", "stock" opcionales — solo las presentes se aplican. Celda vacía en
 * "precio normal"/"stock" = no tocar; vacía en "precio rebajado" = quitar oferta
 * (igual que la exportación, donde vacío = sin oferta).
 */
export function importPreview(products: InvProduct[], sheet: Cell[][]): ImportResult {
  const header = (sheet[0] ?? []).map(fold)
  const col = (...names: string[]) => header.findIndex(h => names.includes(h))
  const cSku = col('sku'), cPrecio = col('precio normal', 'precio', 'regular_price'), cOferta = col('precio rebajado', 'oferta', 'sale_price'), cStock = col('stock', 'stock_quantity', 'cantidad')
  const columnas = { sku: cSku >= 0, precio: cPrecio >= 0, oferta: cOferta >= 0, stock: cStock >= 0 }
  const filas: PreviewRow[] = []
  const ignoradas: ImportResult['ignoradas'] = []
  if (!columnas.sku) return { columnas, filas, ignoradas: [{ fila: 1, motivo: 'falta la columna "SKU"' }], resumen: { total: 0, con_cambios: 0, sin_cambio: 0, errores: 1 } }
  if (!columnas.precio && !columnas.oferta && !columnas.stock) return { columnas, filas, ignoradas: [{ fila: 1, motivo: 'no hay ninguna columna editable (Precio normal, Precio rebajado o Stock)' }], resumen: { total: 0, con_cambios: 0, sin_cambio: 0, errores: 1 } }

  const bySku = new Map<string, { p: InvProduct, v: InvVariation }>()
  for (const p of products) for (const v of p.variations) bySku.set(v.sku, { p, v })
  const seen = new Set<string>()
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] ?? []
    const skuRaw = r[cSku]
    if (skuRaw === null || skuRaw === undefined || String(skuRaw).trim() === '') { if (r.some(c => c !== null)) ignoradas.push({ fila: i + 1, motivo: 'SKU vacío' }); continue }
    const sku = String(skuRaw).trim()
    if (seen.has(sku)) { ignoradas.push({ fila: i + 1, motivo: `SKU repetido: ${sku}` }); continue }
    seen.add(sku)
    const hit = bySku.get(sku)
    if (!hit) { filas.push({ sku, producto: '?', codigo: '', talla: '?', status: 'draft', antes: emptySnap, despues: emptySnap, ops: [], cambia: false, error: 'SKU inexistente' }); continue }
    try {
      const next: { regular?: string, sale?: string, stock?: number } = {}
      if (columnas.precio) { const c = r[cPrecio]; if (c !== null && c !== undefined && String(c).trim() !== '') next.regular = normalizePrice(c as string | number, 'precio normal') }
      if (columnas.oferta) { const c = r[cOferta]; next.sale = c === null || c === undefined || String(c).trim() === '' ? '' : normalizePrice(c as string | number, 'precio rebajado') }
      if (columnas.stock) { const c = r[cStock]; if (c !== null && c !== undefined && String(c).trim() !== '') next.stock = normalizeStock(c) }
      if (next.regular !== undefined || next.sale !== undefined) validatePricePair(next.regular ?? hit.v.regular_price, next.sale ?? hit.v.sale_price)
      filas.push(rowFor(hit.p, hit.v, next))
    }
    catch (err) {
      filas.push(rowFor(hit.p, hit.v, {}, err instanceof InvValidationError ? err.message : String((err as Error)?.message ?? err)))
    }
  }
  const errores = filas.filter(f => f.error).length
  const con = filas.filter(f => !f.error && f.cambia).length
  return { columnas, filas, ignoradas, resumen: { total: filas.length, con_cambios: con, sin_cambio: filas.length - con - errores, errores: errores + ignoradas.length } }
}
const emptySnap: Snap = { regular_price: '', sale_price: '', manage_stock: false, stock_quantity: null, stock_status: 'instock' }
