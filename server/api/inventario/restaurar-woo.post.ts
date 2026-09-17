import { restaurarStockWoo, wooWriteConfigured, type StockRespaldado } from '../../utils/inventoryWoo'

/**
 * "RESTAURAR STOCK EN WOO" — la marcha atrás de aplicar-woo. Recibe el estado de stock
 * de un respaldo (scripts/respaldo-woo.mjs) y lo vuelve a escribir en Woo:
 *   { variaciones: [{ sku, manage_stock, stock_quantity, stock_status }], autor? }
 *
 * SOLO toca manage_stock, stock_quantity y stock_status. Pasa por el adaptador woo (lote
 * de 100 por producto padre) y por su GUARDA (NUXT_INVENTORY_WOO_ONLY_DRAFTS +
 * NUXT_INVENTORY_WOO_ALLOW): lo que la guarda no deje escribir vuelve como fallido, no
 * se ignora. Escribe en Woo sea cual sea NUXT_INVENTORY_BACKEND. Cada cambio queda en
 * inventory_changes con origen 'script'.
 *
 * NO tiene vista previa: la calcula scripts/restaurar-woo.mjs comparando el respaldo con
 * lo que Woo tiene HOY (leído directo con la llave de solo lectura) y aquí solo llegan
 * las variaciones que de verdad difieren. La llave de escritura vive solo en el servidor.
 */
const MAX = 600

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ variaciones?: unknown, autor?: unknown }>(event).catch(() => ({} as any))
  const crudas = Array.isArray(body?.variaciones) ? body.variaciones : []
  if (!crudas.length) throw createError({ statusCode: 422, statusMessage: 'sin_variaciones' })
  if (crudas.length > MAX) throw createError({ statusCode: 422, statusMessage: `demasiadas_variaciones (máx. ${MAX} por llamada)` })
  if (!wooWriteConfigured()) throw createError({ statusCode: 503, statusMessage: 'woo_sin_llave_escritura' })

  const vistos = new Set<string>()
  const items: StockRespaldado[] = []
  for (const c of crudas as Record<string, unknown>[]) {
    const sku = String(c?.sku ?? '').trim()
    if (!sku || vistos.has(sku)) continue
    vistos.add(sku)
    items.push({
      sku,
      manage_stock: c.manage_stock as boolean, // se valida en restaurarStockWoo (debe ser booleano)
      stock_quantity: c.stock_quantity === null || c.stock_quantity === undefined ? null : Number(c.stock_quantity),
      stock_status: String(c.stock_status ?? '') as StockRespaldado['stock_status'],
    })
  }

  const autor = typeof body?.autor === 'string' ? body.autor.trim().slice(0, 60) : undefined
  const resultados = await restaurarStockWoo(items, { origen: 'script', autor })
  invalidateStockState()
  return {
    total: items.length,
    restauradas: resultados.filter(r => r.ok).length,
    fallidas: resultados.filter(r => !r.ok).length,
    resultados,
  }
})
