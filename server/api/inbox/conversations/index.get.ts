/** Lista de conversaciones (más recientes arriba). ?q= busca por nombre o número. */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const q = String(getQuery(event).q ?? '')
  const rows = await listConversations(q)
  return {
    conversations: rows.map(c => ({
      id: c.id,
      canal: c.canal,
      external_id: c.external_id,
      nombre: c.nombre,
      ultimo_mensaje: c.ultimo_mensaje,
      ultima_actividad: c.ultima_actividad,
      ultimo_cliente_at: c.ultimo_cliente_at,
      estado: c.estado,
      no_leidos: c.no_leidos,
      window_open: c.canal === 'wa' ? windowOpen(c.ultimo_cliente_at) : true,
    })),
    now: new Date().toISOString(),
  }
})
