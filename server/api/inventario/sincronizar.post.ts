import { syncStep } from '../../utils/inventorySnapshot'

/**
 * Un paso de sincronización del snapshot con Woo (lectura). Cada llamada procesa
 * hasta SYNC_CHUNK productos variables (≈2 s); el panel repite mientras
 * `pendientes` > 0.
 *
 * `{ force: true, desde }` fuerza releer TODO el catálogo: `desde` es la marca de
 * tiempo del inicio de la tanda y el panel la manda IGUAL en todas las llamadas,
 * para que "fresco" signifique "ya releído en esta tanda". Sin `desde`, un force
 * solo servía en la primera llamada (12 de 109 productos).
 * `{ refrescarLista: true }` salta además la caché de 2 min de la lista de Woo.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ force?: unknown, desde?: unknown, refrescarLista?: unknown }>(event).catch(() => ({} as any))
  const desde = typeof body?.desde === 'string' && !Number.isNaN(Date.parse(body.desde)) ? body.desde : undefined
  return await syncStep({
    force: body?.force === true,
    desde,
    refrescarLista: body?.refrescarLista === true,
  })
})
