import { createHmac, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, readRawBody, type H3Event } from 'h3'

/**
 * FIRMA DE LOS WEBHOOKS DE META (WhatsApp, Messenger, Instagram).
 *
 * Meta firma cada POST con `X-Hub-Signature-256: sha256=<hmac>` = HMAC-SHA256 del
 * cuerpo CRUDO con el App Secret de la app. Sin esta verificación cualquiera que
 * conozca la URL puede inyectar mensajes falsos en la bandeja y hacer que el bot
 * escriba por WhatsApp al número que ponga como remitente.
 *
 * - Se firma y se verifica el cuerpo CRUDO (bytes tal como llegaron). Nunca el JSON
 *   re-serializado: Meta escapa los caracteres no ASCII (\uXXXX) y cualquier
 *   diferencia de espacios o escapes cambia el HMAC.
 * - FAIL-CLOSED: sin NUXT_META_APP_SECRET, sin cabecera o con firma inválida → 401.
 *   Por eso la variable debe existir en Production ANTES de desplegar este código.
 * - El GET de verificación del webhook (hub.verify_token) no pasa por aquí.
 * - El log solo lleva la ruta y el motivo. Nunca el cuerpo ni la firma.
 *
 * MESSENGER / INSTAGRAM — MODO OBSERVACIÓN. No se pudo confirmar que cuelguen de la
 * misma app de Meta que WhatsApp (el App Secret sería otro). Rechazar con el secreto
 * equivocado apagaría ese canal, así que ahí la firma se CALCULA y, si no cuadra, solo
 * se deja un log "[meta-firma] … observación"; el mensaje se procesa igual que antes.
 * Cuando el primer mensaje real de Messenger pase SIN ese log (misma app) o se defina
 * NUXT_MESSENGER_APP_SECRET (otra app), se cambia `soloObservar` a false en el handler.
 *
 * Motivos del log: sin_variable | sin_cabecera | cuerpo_vacio | firma_distinta.
 */
export type CanalFirma = 'whatsapp' | 'messenger'

/** Pura y testeable: ¿la cabecera corresponde al HMAC-SHA256 del cuerpo crudo con ese secreto? */
export function firmaValida(raw: Buffer | Uint8Array, header: string | undefined | null, secret: string): boolean {
  if (!secret || !header) return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim())
  if (!m) return false
  const recibida = Buffer.from(m[1]!, 'hex')
  const esperada = createHmac('sha256', secret).update(raw).digest()
  // Ambos son digests de 32 bytes; si no, no se compara (timingSafeEqual exige igual longitud).
  if (recibida.length !== esperada.length) return false
  return timingSafeEqual(recibida, esperada)
}

function secretoDe(canal: CanalFirma): string {
  const c = useRuntimeConfig()
  const general = String(c.metaAppSecret || '').trim()
  if (canal === 'messenger') return String(c.messengerAppSecret || '').trim() || general
  return general
}

/**
 * Primera línea de los POST de /api/whatsapp y /api/messenger. Devuelve el cuerpo
 * CRUDO ya verificado (el handler parsea el JSON desde estos mismos bytes) o lanza 401.
 */
export type MotivoFirma = 'sin_variable' | 'sin_cabecera' | 'cuerpo_vacio' | 'firma_distinta'

export async function verificarFirmaMeta(event: H3Event, canal: CanalFirma, opts: { soloObservar?: boolean } = {}): Promise<Buffer> {
  const ruta = String(event.path || '').split('?')[0]
  // El cuerpo se lee SIEMPRE crudo y una sola vez: de aquí sale también el JSON.
  const raw = await readRawBody(event, false).catch(() => undefined)
  const buf = !raw ? Buffer.alloc(0) : (Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array))
  const secret = secretoDe(canal)
  const header = getHeader(event, 'x-hub-signature-256')
  const motivo: MotivoFirma | null = !secret
    ? 'sin_variable'
    : !header
        ? 'sin_cabecera'
        : !buf.length
            ? 'cuerpo_vacio'
            : firmaValida(buf, header, secret) ? null : 'firma_distinta'
  if (!motivo) return buf
  if (opts.soloObservar) {
    console.warn(`[meta-firma] ${ruta} observación: ${motivo} (no se rechaza)`)
    return buf
  }
  console.warn(`[meta-firma] ${ruta} rechazado (401): ${motivo}`)
  throw createError({ statusCode: 401, message: 'Firma inválida' })
}

/** JSON desde el cuerpo crudo ya verificado. null si no es JSON. */
export function jsonDeCrudo<T = unknown>(raw: Buffer): T | null {
  try {
    return JSON.parse(raw.toString('utf8')) as T
  }
  catch {
    return null
  }
}
