import { publicStockPayload } from '../utils/stockState'

/**
 * PÚBLICO: qué está agotado, para la lógica de agotado del sitio (talla en 0 no
 * seleccionable, producto en 0 fuera del catálogo). Solo códigos y tallas, sin
 * cantidades. `enabled:false` = el stock no aplica al sitio (ver stockState.ts).
 * Cacheado 2 min en el servidor; el plugin app/plugins/stock.ts lo hidrata en SSR.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'public, max-age=60, s-maxage=120')
  return await publicStockPayload()
})
