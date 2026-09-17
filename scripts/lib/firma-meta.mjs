// FIRMA DE META PARA LOS SCRIPTS DE PRUEBA. Los POST de /api/whatsapp y /api/messenger
// exigen X-Hub-Signature-256 (server/utils/metaFirma.ts, fail-closed). Importar este
// módulo (`import './lib/firma-meta.mjs'`) envuelve fetch una sola vez: a todo POST a
// esas dos rutas con cuerpo de texto le añade la firma HMAC-SHA256 del cuerpo EXACTO
// que se envía. El secreto sale del MISMO archivo que carga `npm run dev:test`
// (.env.test → NUXT_META_APP_SECRET), o del entorno. Es un valor LOCAL de pruebas:
// no tiene por qué ser el App Secret real de Meta, solo coincidir con el del servidor
// local. Sin secreto no se firma y el servidor responderá 401 (el test falla claro).
import { createHmac } from 'node:crypto'
import { cargarEnv } from './guard-bd.mjs'

const RUTAS = /\/api\/(whatsapp|messenger)(\?|$)/
const secreto = (canal) => {
  const env = cargarEnv('.env.test')
  const general = String(env.NUXT_META_APP_SECRET ?? '').trim()
  return canal === 'messenger' ? (String(env.NUXT_MESSENGER_APP_SECRET ?? '').trim() || general) : general
}

let avisado = false
if (!globalThis.__firmaMetaInstalada) {
  globalThis.__firmaMetaInstalada = true
  const real = globalThis.fetch
  globalThis.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    const m = RUTAS.exec(url)
    if (m && String(init.method ?? 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
      const s = secreto(m[1])
      if (s) {
        const firma = 'sha256=' + createHmac('sha256', s).update(Buffer.from(init.body, 'utf8')).digest('hex')
        init = { ...init, headers: { ...(init.headers ?? {}), 'x-hub-signature-256': firma } }
      }
      else if (!avisado) {
        avisado = true
        console.error('⚠️ falta NUXT_META_APP_SECRET en .env.test: los webhooks simulados irán sin firma y el servidor responderá 401')
      }
    }
    return real(input, init)
  }
}
