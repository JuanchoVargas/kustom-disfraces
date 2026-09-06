import { syncStep } from '../../utils/inventorySnapshot'

/**
 * Un paso de sincronización del snapshot con Woo (lectura). Cada llamada procesa
 * hasta SYNC_CHUNK productos variables (≈2 s); el panel repite mientras
 * `pendientes` > 0. `{ force: true }` fuerza releer todo.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const body = await readBody<{ force?: unknown }>(event).catch(() => ({} as any))
  return await syncStep(body?.force === true)
})
