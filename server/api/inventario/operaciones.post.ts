import type { InvChangeOrigin, InvOperation } from '~~/shared/types/inventory'

/**
 * Escrituras: una o varias operaciones sobre variaciones (por SKU de talla).
 *   { operaciones: [{op:'price', sku, regular_price, sale_price} | {op:'stock', sku, stock_quantity}],
 *     origen?: 'panel'|'masivo'|'importacion'|'script', autor?: string }
 * 1 operación → updateVariationPrice/Stock; varias → bulkUpdate (batch de 100 en Woo).
 * Devuelve un resultado por operación (ok/error + antes/después). Nunca 500 por
 * una operación inválida: se reporta en su fila.
 */
const ORIGENES: InvChangeOrigin[] = ['panel', 'masivo', 'importacion', 'script', 'prueba']
const MAX_OPS = 2000

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ operaciones?: unknown, origen?: unknown, autor?: unknown }>(event).catch(() => ({} as any))
  const raw = Array.isArray(body?.operaciones) ? body.operaciones : []
  if (!raw.length) throw createError({ statusCode: 400, statusMessage: 'sin_operaciones' })
  if (raw.length > MAX_OPS) throw createError({ statusCode: 413, statusMessage: `maximo_${MAX_OPS}_operaciones` })

  const operaciones: InvOperation[] = []
  const invalid: { sku: string, error: string }[] = []
  for (const r of raw as any[]) {
    const sku = String(r?.sku ?? '').trim()
    if (!sku) { invalid.push({ sku: '', error: 'sku vacío' }); continue }
    if (r?.op === 'price') operaciones.push({ op: 'price', sku, regular_price: r.regular_price ?? null, sale_price: r.sale_price ?? null })
    else if (r?.op === 'stock') operaciones.push({ op: 'stock', sku, stock_quantity: Number(r.stock_quantity), manage_stock: r.manage_stock === false ? false : true })
    else invalid.push({ sku, error: `op desconocida: ${String(r?.op)}` })
  }
  const origenRaw = String(body?.origen ?? 'panel') as InvChangeOrigin
  const ctx = {
    origen: ORIGENES.includes(origenRaw) ? origenRaw : 'panel' as InvChangeOrigin,
    autor: typeof body?.autor === 'string' && body.autor.trim() ? body.autor.trim().slice(0, 60) : undefined,
  }
  const store = getInventoryStore()
  let resultados
  if (operaciones.length === 1) {
    const op = operaciones[0]!
    resultados = [op.op === 'price'
      ? await store.updateVariationPrice(op.sku, op.regular_price, op.sale_price, ctx)
      : await store.updateVariationStock(op.sku, op.stock_quantity, ctx)]
  }
  else {
    resultados = operaciones.length ? await store.bulkUpdate(operaciones, ctx) : []
  }
  const all = [...resultados, ...invalid.map(i => ({ sku: i.sku, ok: false, error: i.error }))]
  return { backend: store.backend, simulation: store.simulation, ok: all.filter(r => r.ok).length, fallidas: all.filter(r => !r.ok).length, resultados: all }
})
