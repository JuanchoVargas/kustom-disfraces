import { MOTIVOS_PQRS } from '~~/shared/utils/pqrs'
import { createMailTransport, mailerConfigured } from '../utils/mailer'
import { buildPqrsAckEmail, buildPqrsInternalEmail } from '../utils/pqrsEmail'

/**
 * Recibe el formulario PQRS (/pqrs), valida en servidor y envía:
 *   1. correo interno a contacto@ con copia OCULTA (BCC) a ventas@,
 *   2. acuse de recibo al cliente ("recibimos tu solicitud").
 * SMTP compartido (mailer.ts). Sin credenciales -> 503 not_configured, como
 * /api/mayoristas.
 *
 * Anti-spam SIN reCAPTCHA (acordado con el cliente, sep 2026):
 *   - honeypot `website` (campo oculto que un humano nunca rellena),
 *   - trampa de tiempo: la página manda `startedAt` (ms al montar el form);
 *     un envío a <3 s (o sin el campo, típico de POST directo de bot) se
 *     descarta fingiendo éxito,
 *   - límite por IP: máx 3 envíos cada 10 min. En serverless es best-effort
 *     (cada instancia tiene su propia memoria), suficiente para este form.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const clean = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max)

const MIN_FILL_MS = 3000
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 3
// timestamps de envíos por IP (memoria de la instancia; se poda en cada request)
const hitsByIp = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (hitsByIp.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) {
    hitsByIp.set(ip, hits)
    return true
  }
  hits.push(now)
  hitsByIp.set(ip, hits)
  // poda global perezosa: que el Map no crezca sin límite en instancias longevas
  if (hitsByIp.size > 5000) {
    for (const [k, v] of hitsByIp) {
      if (v.every(t => now - t >= RATE_WINDOW_MS)) hitsByIp.delete(k)
    }
  }
  return false
}

interface PqrsBody {
  nombre?: string
  apellido?: string
  email?: string
  telefono?: string
  motivo?: string
  mensaje?: string
  acepta?: boolean
  /** honeypot anti-bots */
  website?: string
  /** trampa de tiempo: Date.now() al montar el formulario */
  startedAt?: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<PqrsBody>(event)

  // ---------- trampas anti-bot: se finge éxito, no se envía nada ----------
  if (clean(body?.website)) return { ok: true }
  const startedAt = Number(body?.startedAt)
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < MIN_FILL_MS) {
    return { ok: true }
  }

  // ---------- límite por IP ----------
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  if (rateLimited(ip)) {
    throw createError({
      statusCode: 429,
      message: 'Demasiados envíos',
      data: { code: 'rate_limited' },
    })
  }

  // ---------- validación server-side (no confiar en el cliente) ----------
  const nombre = clean(body?.nombre, 120)
  const apellido = clean(body?.apellido, 120)
  const email = clean(body?.email, 160)
  const telefono = clean(body?.telefono, 40)
  const motivo = clean(body?.motivo, 60)
  const mensaje = clean(body?.mensaje, 4000)
  const acepta = body?.acepta === true

  const errors: Record<string, string> = {}
  if (!nombre) errors.nombre = 'Requerido'
  if (!apellido) errors.apellido = 'Requerido'
  if (!email) errors.email = 'Requerido'
  else if (!EMAIL_RE.test(email)) errors.email = 'Correo no válido'
  if (!telefono) errors.telefono = 'Requerido'
  if (!(MOTIVOS_PQRS as readonly string[]).includes(motivo)) errors.motivo = 'Selecciona un motivo'
  if (!mensaje) errors.mensaje = 'Requerido'
  if (!acepta) errors.acepta = 'Debes aceptar la política de tratamiento de datos'

  if (Object.keys(errors).length) {
    throw createError({ statusCode: 422, message: 'Datos incompletos', data: { errors } })
  }

  // ---------- SMTP ----------
  if (!mailerConfigured()) {
    throw createError({
      statusCode: 503,
      message: 'Envío no configurado',
      data: { code: 'not_configured' },
    })
  }

  const cfg = useRuntimeConfig()
  const transporter = createMailTransport()
  const from = cfg.smtpFrom || cfg.smtpUser
  const to = cfg.pqrsTo || 'contacto@disfraceskustom.com'
  const bcc = cfg.ventasTo || 'ventas@disfraceskustom.com'

  const fecha = new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date())

  const data = { nombre, apellido, email, telefono, motivo, mensaje, fecha }
  const interno = buildPqrsInternalEmail(data)

  try {
    await transporter.sendMail({
      from: `"PQRS Kustom" <${from}>`,
      to,
      bcc,
      replyTo: email,
      subject: interno.subject,
      text: interno.text,
      html: interno.html,
    })
  }
  catch (err) {
    console.error('[pqrs] fallo al enviar correo interno:', err)
    throw createError({ statusCode: 502, message: 'No se pudo enviar la solicitud' })
  }

  // Acuse al cliente: si falla NO tumba el flujo (la solicitud ya llegó al equipo)
  try {
    const acuse = buildPqrsAckEmail(data)
    await transporter.sendMail({
      from: `"Kustom Disfraces" <${from}>`,
      to: email,
      subject: acuse.subject,
      text: acuse.text,
      html: acuse.html,
    })
  }
  catch (err) {
    console.error('[pqrs] fallo al enviar acuse al cliente:', err)
  }

  return { ok: true }
})
