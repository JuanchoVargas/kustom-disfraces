import type { ListFilter } from '../../../utils/inbox'

/**
 * Lista de conversaciones (más recientes arriba). NUNCA se ocultan por antigüedad
 * (remarketing): sin filtros vienen todas las activas.
 *   ?q=      busca en nombre, número, BSUID, username y en el TEXTO de todos los mensajes
 *   ?estado= activas (default) | archivadas | todas
 *   ?desde=  ?hasta=  rango ISO sobre la última actividad (hasta exclusivo)
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const query = getQuery(event)
  const q = String(query.q ?? '')
  const filterRaw = String(query.estado ?? 'activas')
  const filter: ListFilter = filterRaw === 'archivadas' || filterRaw === 'todas' ? filterRaw : 'activas'
  const iso = (v: unknown) => {
    const s = String(v ?? '').trim()
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const rows = await listConversations({ q, filter, desde: iso(query.desde), hasta: iso(query.hasta) })
  return {
    conversations: rows.map(c => ({
      id: c.id,
      canal: c.canal,
      external_id: c.external_id,
      nombre: c.nombre,
      telefono: c.telefono ?? null,
      bsuid: c.bsuid ?? null,
      username: c.username ?? null,
      ultimo_mensaje: c.ultimo_mensaje,
      ultima_actividad: c.ultima_actividad,
      ultimo_cliente_at: c.ultimo_cliente_at,
      estado: c.estado,
      no_leidos: c.no_leidos,
      archivada_at: c.archivada_at ?? null,
      window_open: c.canal === 'wa' ? windowOpen(c.ultimo_cliente_at) : true,
    })),
    filter,
    now: new Date().toISOString(),
  }
})
