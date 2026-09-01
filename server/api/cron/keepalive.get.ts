/**
 * KEEP-ALIVE de la BD: Neon (plan free) suspende la base tras ~5 min sin actividad
 * y la primera consulta del despertar puede fallar o tardar (bot mudo o lento).
 * Este endpoint hace un SELECT 1 y lo llama el cron de Vercel (vercel.json) cada
 * 5 minutos para que la BD no llegue a dormirse.
 *
 * OJO: en el plan Hobby de Vercel los crons corren máx. 1 vez al día; el cada-5-min
 * real requiere plan Pro (o un pinger externo tipo cron-job.org apuntando aquí).
 */
export default defineEventHandler(async () => {
  if (!dbConfigured()) return { ok: false, db: 'sin_configurar' }
  const t0 = Date.now()
  try {
    await sql().query('SELECT 1')
    const ms = Date.now() - t0
    console.info(`[keepalive] BD viva (${ms}ms)`)
    return { ok: true, ms }
  }
  catch (err) {
    const msg = String((err as Error)?.message ?? err)
    console.error('[keepalive] ⚠️ BD no respondió:', msg)
    return { ok: false, error: msg, ms: Date.now() - t0 }
  }
})
