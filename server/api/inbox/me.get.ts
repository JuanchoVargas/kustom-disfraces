import { dbConfigured, ensureSchema, sql } from '../../utils/db'

/**
 * ¿Hay sesión? Lo consultan las páginas de /admin al cargar para decidir login
 * vs panel. Con sesión, añade `sin_responder`: conversaciones activas con
 * mensajes del cliente sin leer (badge en /admin y en "Mensajes de clientes").
 */
export default defineEventHandler(async (event) => {
  const authenticated = hasValidSession(event)
  let sin_responder = 0
  if (authenticated && dbConfigured()) {
    try {
      await ensureSchema()
      const r = await sql().query(`SELECT count(*)::int AS n FROM conversations WHERE archivada_at IS NULL AND no_leidos > 0`) as { n: number }[]
      sin_responder = r[0]?.n ?? 0
    }
    catch (err) {
      console.warn('[inbox/me] no se pudo contar sin responder:', String((err as Error)?.message ?? err))
    }
  }
  return { configured: inboxConfigured(), authenticated, db: dbConfigured(), sin_responder }
})
