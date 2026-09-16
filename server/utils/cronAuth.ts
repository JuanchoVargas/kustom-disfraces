import { createHash, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'

/**
 * Protección de los endpoints de cron (/api/cron/*). Vercel manda en cada
 * ejecución programada la cabecera `Authorization: Bearer <CRON_SECRET>` cuando
 * la variable CRON_SECRET existe en el proyecto; aquí se exige exactamente eso.
 *
 * FAIL-CLOSED: sin CRON_SECRET configurada, o con una cabecera ausente o distinta,
 * el endpoint responde 401 y no ejecuta nada. Vercel solo ejecuta los crons en el
 * deployment de Production, así que CRON_SECRET debe existir en Production ANTES
 * de desplegar este código (ver README, "Deploy"); en Preview es opcional y solo
 * sirve para pruebas manuales.
 *
 * Se lee de process.env (no de runtimeConfig) porque es el nombre que Vercel usa
 * de forma nativa y no lleva prefijo NUXT_.
 *
 * La comparación es sobre sha256 de ambos valores: así los buffers siempre miden
 * lo mismo y timingSafeEqual nunca lanza por longitudes distintas (sería un 500).
 */
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest()

export function requireCron(event: H3Event): void {
  const secret = String(process.env.CRON_SECRET ?? '').trim()
  const token = String(getHeader(event, 'authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const ok = !!secret && !!token && timingSafeEqual(sha256(token), sha256(secret))
  if (ok) return
  console.error(`[cron] ${event.path} rechazado (401): ${secret ? 'Authorization ausente o incorrecta' : 'CRON_SECRET sin configurar en el entorno'}`)
  throw createError({ statusCode: 401, message: 'No autorizado' })
}
