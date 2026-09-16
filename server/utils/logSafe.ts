/**
 * LOGS SIN DATOS PERSONALES.
 *
 * Los logs de Vercel se conservan y los lee cualquiera con acceso al proyecto. Un
 * teléfono, un nombre, un correo o el texto de un cliente no deben quedar ahí.
 * Regla: se registra el EVENTO (qué pasó, a qué conversación, con qué wamid),
 * nunca el DATO. Estas utilidades son la única forma aprobada de meter un
 * identificador de cliente en un log.
 *
 *  - maskId(): teléfono, BSUID (CO.1234…) o PSID/IGSID → solo los últimos 4.
 *  - redactDigits(): en un texto arbitrario (p. ej. el error de Graph) enmascara
 *    cualquier número largo, que casi siempre es un teléfono o un id de usuario.
 *  - payloadShape(): estructura (claves y tipos) de un payload, sin valores.
 *  - logPayloadShape(): la imprime SOLO con NUXT_DEBUG_PAYLOADS=true.
 *
 * Lo que NUNCA debe pasar por un console.*: nombre de perfil, dirección, correo
 * ni texto del cliente. Ni enmascarados. scripts/test-log-seguro.mjs lo vigila.
 */

const KEEP = 4

/** Últimos 4 caracteres de un identificador; el resto se sustituye por ***. */
export function maskId(id: unknown): string {
  const s = String(id ?? '').trim()
  if (!s) return '—'
  // BSUID de WhatsApp: "CO.1041701705436358" → "CO.***6358" (el prefijo de país
  // no identifica a nadie y ayuda a distinguirlo de un teléfono).
  const m = /^([A-Za-z]{1,3}\.)(.+)$/.exec(s)
  if (m) return `${m[1]}***${m[2].slice(-KEEP)}`
  if (s.length <= KEEP) return '***'
  return `***${s.slice(-KEEP)}`
}

/** Enmascara toda secuencia de 7 o más dígitos dentro de un texto (teléfonos, ids). */
export function redactDigits(text: unknown): string {
  return String(text ?? '').replace(/\d{7,}/g, d => `***${d.slice(-KEEP)}`)
}

/**
 * Estructura de un valor: claves y tipos, nunca valores. Los arrays se resumen con
 * su longitud y la forma del primer elemento. Profundidad acotada.
 */
export function payloadShape(value: unknown, depth = 0): string {
  // Los webhooks de Meta anidan ~9 niveles (entry[].changes[].value.contacts[].profile.name).
  if (depth > 14) return '…'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length}×${value.length ? payloadShape(value[0], depth + 1) : ''}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return `{${entries.map(([k, v]) => `${k}:${payloadShape(v, depth + 1)}`).join(',')}}`
  }
  return typeof value
}

/** NUXT_DEBUG_PAYLOADS=true (default false). Solo estructura, nunca valores. */
export function debugPayloads(): boolean {
  try {
    return useRuntimeConfig().debugPayloads === true
  }
  catch {
    return false
  }
}

/** Registra la forma del payload de un webhook, únicamente con el flag activo. */
export function logPayloadShape(tag: string, body: unknown): void {
  if (!debugPayloads()) return
  console.log(`[${tag}] shape=${payloadShape(body)}`)
}
