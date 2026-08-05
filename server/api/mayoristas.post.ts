import nodemailer from 'nodemailer'

/**
 * Recibe el formulario de "Ventas al por mayor" y lo envía por correo a
 * contacto@disfraceskustom.com vía SMTP (Hostinger). Las credenciales viven en
 * runtimeConfig (env, solo servidor) — NADA hardcodeado. Si el SMTP no está
 * configurado, responde 503 { code: 'not_configured' } sin romper el sitio.
 */

interface MayoristaBody {
  nombre?: string
  apellido?: string
  telefono?: string
  email?: string
  ciudad?: string
  mensaje?: string
  acepta?: boolean
  // honeypot anti-bots: campo oculto que un humano nunca rellena
  website?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const clean = (v: unknown, max = 2000) => String(v ?? '').trim().slice(0, max)
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default defineEventHandler(async (event) => {
  const body = await readBody<MayoristaBody>(event)

  // Honeypot: si viene relleno, es un bot. Fingimos éxito y no enviamos nada.
  if (clean(body?.website)) {
    return { ok: true }
  }

  // ---------- validación server-side (no confiar en el cliente) ----------
  const nombre = clean(body?.nombre, 120)
  const apellido = clean(body?.apellido, 120)
  const telefono = clean(body?.telefono, 40)
  const email = clean(body?.email, 160)
  const ciudad = clean(body?.ciudad, 120)
  const mensaje = clean(body?.mensaje, 4000)
  const acepta = body?.acepta === true

  const errors: Record<string, string> = {}
  if (!nombre) errors.nombre = 'Requerido'
  if (!apellido) errors.apellido = 'Requerido'
  if (!telefono) errors.telefono = 'Requerido'
  if (!email) errors.email = 'Requerido'
  else if (!EMAIL_RE.test(email)) errors.email = 'Correo no válido'
  if (!ciudad) errors.ciudad = 'Requerido'
  if (!mensaje) errors.mensaje = 'Requerido'
  if (!acepta) errors.acepta = 'Debes aceptar la política de datos'

  if (Object.keys(errors).length) {
    throw createError({ statusCode: 422, message: 'Datos incompletos', data: { errors } })
  }

  // ---------- SMTP ----------
  const cfg = useRuntimeConfig()
  if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
    // Aún no hay credenciales: el front muestra un fallback con el correo directo.
    throw createError({
      statusCode: 503,
      message: 'Envío no configurado',
      data: { code: 'not_configured' },
    })
  }

  const port = Number(cfg.smtpPort) || 465
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port,
    secure: port === 465, // 465 = SSL directo; 587 = STARTTLS
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
  })

  const to = cfg.mayoristasTo || 'contacto@disfraceskustom.com'
  const from = cfg.smtpFrom || cfg.smtpUser

  const rows: [string, string][] = [
    ['Nombre', `${nombre} ${apellido}`],
    ['Teléfono', telefono],
    ['Correo', email],
    ['Ciudad', ciudad],
    ['Mensaje', mensaje],
  ]
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
  const html = `
    <h2 style="font-family:Arial,sans-serif">Nueva solicitud de ventas al por mayor</h2>
    <table style="font-family:Arial,sans-serif;border-collapse:collapse">
      ${rows.map(([k, v]) => `
        <tr>
          <td style="padding:6px 12px;font-weight:bold;vertical-align:top">${k}</td>
          <td style="padding:6px 12px">${esc(v).replace(/\n/g, '<br>')}</td>
        </tr>`).join('')}
    </table>`

  try {
    await transporter.sendMail({
      from: `"Mayoristas Kustom" <${from}>`,
      to,
      replyTo: email,
      subject: `Mayoristas — ${nombre} ${apellido} (${ciudad})`,
      text,
      html,
    })
  }
  catch (err) {
    console.error('[mayoristas] fallo al enviar correo:', err)
    throw createError({ statusCode: 502, message: 'No se pudo enviar el correo' })
  }

  return { ok: true }
})
