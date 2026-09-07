import { listChanges } from '../../utils/inventoryCommon'

/** Registro de cambios (más recientes primero). ?sku= filtra por producto o variación; ?page= ?per_page= */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const q = getQuery(event)
  return await listChanges({ sku: typeof q.sku === 'string' ? q.sku : '', page: Number(q.page) || 1, per_page: Number(q.per_page) || 50 })
})
