import { mediaStats } from '../../utils/media'

/**
 * Uso del almacenamiento de medios de la bandeja (tabla media en Neon): bytes
 * usados, número de archivos, más antiguo/reciente, tope y retención. Lo muestra
 * /admin/chats en la cabecera. Requiere sesión del panel.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const s = await mediaStats()
  if (!s) return { db: false }
  return { db: true, ...s, mb: Math.round((s.bytes / 1048576) * 10) / 10, limite_mb: Math.round(s.limite_bytes / 1048576) }
})
