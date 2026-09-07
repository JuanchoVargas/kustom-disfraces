/**
 * KEEP-ALIVE de la BD: Neon (plan free) suspende la base tras ~5 min sin actividad
 * y la primera consulta del despertar puede fallar o tardar (bot mudo o lento).
 * Este endpoint hace un SELECT 1 y lo llama el cron de Vercel (vercel.json) cada
 * 5 minutos para que la BD no llegue a dormirse.
 *
 * OJO: en el plan Hobby de Vercel los crons corren máx. 1 vez al día; el cada-5-min
 * real requiere plan Pro (o un pinger externo tipo cron-job.org apuntando aquí).
 */
import { mediaStats, purgeExpiredMedia } from '../../utils/media'

export default defineEventHandler(async () => {
  if (!dbConfigured()) return { ok: false, db: 'sin_configurar' }
  const t0 = Date.now()
  try {
    await sql().query('SELECT 1')
    // RETENCIÓN DE MEDIOS (mismo cron diario): borra los binarios de más de N
    // días conservando el mensaje ("[archivo expirado]"). Best-effort.
    const retencion = await purgeExpiredMedia().catch((err) => {
      console.error('[keepalive] retención de medios falló:', String((err as Error)?.message ?? err))
      return { borrados: 0, bytes: 0, mensajes: 0, dias: 0, error: true }
    })
    const uso = await mediaStats().catch(() => null)
    if (uso && uso.pct >= 80) console.error(`[keepalive] ⚠️ medios al ${uso.pct}% del tope (${(uso.bytes / 1048576).toFixed(1)} MB de ${(uso.limite_bytes / 1048576).toFixed(0)} MB)`)
    const ms = Date.now() - t0
    console.info(`[keepalive] BD viva (${ms}ms) · medios: ${retencion.borrados} borrados por retención, uso ${uso ? `${uso.pct}%` : '?'}`)
    return { ok: true, ms, retencion, medios: uso ? { mb: Math.round(uso.bytes / 1048576 * 10) / 10, archivos: uso.archivos, pct: uso.pct } : null }
  }
  catch (err) {
    const msg = String((err as Error)?.message ?? err)
    console.error('[keepalive] ⚠️ BD no respondió:', msg)
    return { ok: false, error: msg, ms: Date.now() - t0 }
  }
})
