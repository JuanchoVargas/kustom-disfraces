import type { InvOperation, InvVariation } from '~~/shared/types/inventory'
import { applyOverride, deleteOverrides, getOverrides } from '../../utils/inventoryMock'
import { createWooStore, wooWriteConfigured } from '../../utils/inventoryWoo'
import { loadProductBySku } from '../../utils/inventorySnapshot'

/**
 * "APLICAR OVERRIDES A WOO" — para el día del cambio de adaptador.
 *   { preview: true }  → lista antes → después de cada sobreescritura pendiente,
 *                        comparando contra lo que Woo tiene HOY (snapshot). No escribe.
 *   { preview: false, autor? } → escribe en Woo (adaptador woo, batch de 100) con
 *                        origen 'script', registra los cambios y BORRA las
 *                        sobreescrituras aplicadas con éxito. Las fallidas quedan.
 * SUBCONJUNTO (para la primera ejecución real sobre UN solo producto):
 *   solo:   ['001003001', '001001001-T4']  → solo esas sobreescrituras (SKU de
 *           producto = todas sus tallas; SKU de variación = esa talla)
 *   estado: 'draft' | 'publish'            → solo productos en ese estado
 *   limite: N                              → como mucho N sobreescrituras
 * Los filtros aplican a la vista previa y a la aplicación por igual.
 * Lo llama scripts/aplicar-overrides-woo.mjs; también se puede usar desde el panel.
 */
interface Fila {
  sku: string
  producto: string
  antes: Partial<InvVariation>
  despues: Partial<InvVariation>
  ops: InvOperation[]
  sin_cambio: boolean
  error?: string
}

const pick = (v: InvVariation | null | undefined): Partial<InvVariation> => v
  ? { regular_price: v.regular_price, sale_price: v.sale_price, manage_stock: v.manage_stock, stock_quantity: v.stock_quantity, stock_status: v.stock_status }
  : {}

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ preview?: unknown, autor?: unknown, solo?: unknown, estado?: unknown, limite?: unknown }>(event).catch(() => ({} as any))
  const preview = body?.preview !== false
  const solo = Array.isArray(body?.solo) ? body.solo.map((s: unknown) => String(s).trim()).filter(Boolean) : []
  const estado = body?.estado === 'draft' || body?.estado === 'publish' ? body.estado : null
  const limite = Number.isFinite(Number(body?.limite)) && Number(body.limite) > 0 ? Math.floor(Number(body.limite)) : null
  const overrides = await getOverrides()

  const filas: Fila[] = []
  let omitidas = 0
  for (const o of overrides.values()) {
    const p = await loadProductBySku(o.sku)
    const v = p?.variations.find(x => x.sku === o.sku)
    // --- filtros de subconjunto ---
    if (solo.length && !solo.includes(o.sku) && !(p && solo.includes(p.sku))) { omitidas++; continue }
    if (estado && p && p.status !== estado) { omitidas++; continue }
    if (limite !== null && filas.length >= limite) { omitidas++; continue }
    if (!p || !v) {
      filas.push({ sku: o.sku, producto: '?', antes: {}, despues: {}, ops: [], sin_cambio: false, error: 'SKU de variación inexistente en el snapshot de Woo' })
      continue
    }
    const target = applyOverride(v, o)
    const ops: InvOperation[] = []
    if (o.regular_price !== null || o.sale_price !== null) {
      if (target.regular_price !== v.regular_price || target.sale_price !== v.sale_price) {
        ops.push({ op: 'price', sku: o.sku, regular_price: target.regular_price, sale_price: target.sale_price })
      }
    }
    if (o.stock_quantity !== null || o.manage_stock !== null) {
      if (target.manage_stock !== v.manage_stock || target.stock_quantity !== v.stock_quantity) {
        ops.push({ op: 'stock', sku: o.sku, stock_quantity: target.stock_quantity ?? 0, manage_stock: target.manage_stock })
      }
    }
    filas.push({ sku: o.sku, producto: p.name, antes: pick(v), despues: pick(target), ops, sin_cambio: ops.length === 0 })
  }

  const filtro = { solo, estado, limite, omitidas, pendientes_total: overrides.size }
  if (preview) {
    return { preview: true, woo_escritura: wooWriteConfigured(), total: filas.length, con_cambios: filas.filter(f => f.ops.length).length, filas, filtro }
  }
  if (!wooWriteConfigured()) throw createError({ statusCode: 503, statusMessage: 'woo_sin_llave_escritura' })

  const store = createWooStore()
  const ops = filas.flatMap(f => f.ops)
  const autor = typeof body?.autor === 'string' ? body.autor.trim().slice(0, 60) : undefined
  const resultados = ops.length ? await store.bulkUpdate(ops, { origen: 'script', autor }) : []
  const okBySku = new Map<string, boolean>()
  for (const r of resultados) okBySku.set(r.sku, (okBySku.get(r.sku) ?? true) && r.ok)
  // Sin cambio pendiente (Woo ya coincide) o aplicadas con éxito → se retira la sobreescritura.
  const aplicadas = filas.filter(f => !f.error && (f.sin_cambio || okBySku.get(f.sku) === true)).map(f => f.sku)
  await deleteOverrides(aplicadas)
  return {
    preview: false,
    total: filas.length,
    aplicadas: aplicadas.length,
    fallidas: resultados.filter(r => !r.ok).length,
    resultados,
    pendientes_restantes: filas.length - aplicadas.length,
    filtro,
  }
})
