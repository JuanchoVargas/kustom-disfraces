import type { BulkSpec } from '../../utils/inventoryBulk'
import { bulkPreview } from '../../utils/inventoryBulk'

/**
 * VISTA PREVIA de una operación masiva (no escribe). Body = BulkSpec:
 *   { skus?: [...códigos], filtros?: {...}, tallas?: ['4','6'],
 *     precio?: {modo:'fijar'|'porcentaje'|'monto', valor, redondeo?},
 *     oferta?: {modo:'fijar'|'porcentaje'|'quitar', valor?},
 *     stock?:  {modo:'fijar'|'sumar'|'agotar'|'gestionar', valor?} }
 * Devuelve una fila por talla con antes → después y las operaciones a enviar
 * a /api/inventario/operaciones (origen 'masivo') si el usuario confirma.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const spec = await readBody<BulkSpec>(event).catch(() => ({} as BulkSpec))
  if (!spec.precio && !spec.oferta && !spec.stock) throw createError({ statusCode: 400, statusMessage: 'sin_operacion' })
  if (!spec.skus?.length && !spec.filtros) throw createError({ statusCode: 400, statusMessage: 'sin_objetivo' })
  const store = getInventoryStore()
  // Se parte del inventario con las sobreescrituras aplicadas (lo que ve el panel).
  const all = await store.listProducts({ page: 1, per_page: 100 })
  const products = [...all.items]
  for (let page = 2; page <= all.total_pages; page++) products.push(...(await store.listProducts({ page, per_page: 100 })).items)
  const { filas, productos } = bulkPreview(products, spec)
  return {
    productos,
    total: filas.length,
    con_cambios: filas.filter(f => f.cambia && !f.error).length,
    errores: filas.filter(f => f.error).length,
    filas,
    simulation: store.simulation,
  }
})
