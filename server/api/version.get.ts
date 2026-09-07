/**
 * GET /api/version — qué código está corriendo. Público e inofensivo (el repo y
 * los hashes ya son visibles en GitHub). Motivo: Vercel Hobby rechazó deploys en
 * silencio dos veces (crons de más de 1/día) y nadie lo notó hasta comparar
 * hashes. Verificar un deploy = abrir esta URL y comparar con `git rev-parse
 * origin/master` (scripts/verificar-deploy.mjs lo automatiza).
 *
 * Los datos se fijan en el BUILD (runtimeConfig.public.build); si faltan, se
 * leen del entorno en ejecución (Vercel expone VERCEL_GIT_* a las funciones).
 */
export default defineEventHandler((event) => {
  const b = useRuntimeConfig().public.build as { commit?: string, rama?: string, entorno?: string, fecha?: string }
  const commit = b.commit || process.env.VERCEL_GIT_COMMIT_SHA || ''
  setHeader(event, 'Cache-Control', 'no-store')
  return {
    commit: commit || null,
    commit_corto: commit ? commit.slice(0, 7) : null,
    rama: b.rama || process.env.VERCEL_GIT_COMMIT_REF || null,
    entorno: b.entorno || process.env.VERCEL_ENV || 'local',
    build: b.fecha || null,
    deployment: process.env.VERCEL_DEPLOYMENT_ID || null,
    url_deploy: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  }
})
