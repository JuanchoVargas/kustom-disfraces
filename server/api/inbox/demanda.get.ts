import { demandReport } from '../../utils/botDemand'

/** Reporte de demanda: qué buscan los clientes y el bot no encuentra. ?desde=ISO ?limit= */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const q = getQuery(event)
  const desde = typeof q.desde === 'string' && q.desde ? new Date(q.desde) : null
  return { items: await demandReport({ desde: desde && !Number.isNaN(desde.getTime()) ? desde.toISOString() : undefined, limit: Number(q.limit) || 100 }) }
})
