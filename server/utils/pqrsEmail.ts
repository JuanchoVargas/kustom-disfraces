/**
 * Plantillas de correo del formulario PQRS (misma identidad de marca que
 * orderEmail.ts: estilos INLINE, imágenes por URL absoluta al sitio canónico).
 * - Interno: notificación a contacto@ (BCC ventas@) con todos los datos + fecha.
 * - Acuse: "recibimos tu solicitud" al cliente, con header morado y KO.
 */

// Paleta de marca (literales — el correo no puede leer los tokens del sitio)
const C = {
  purple: '#7E57C2',
  purpleSoft: '#EADDF7',
  ink: '#111111',
  crema: '#F7F6F2',
  muted: '#A7A49D',
  line: '#E7E4DE',
  white: '#FFFFFF',
}

const WHATSAPP_URL = 'https://wa.me/573118844547'
const WHATSAPP_NUM = '311 884 4547'
const HOURS = 'Lunes a sábado, 8:00 a.m. a 7:00 p.m.'

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface PqrsEmailData {
  nombre: string
  apellido: string
  email: string
  telefono: string
  motivo: string
  mensaje: string
  /** Fecha ya formateada en hora de Colombia (la calcula el endpoint). */
  fecha: string
  siteUrl?: string
}

const base = (d: PqrsEmailData) => (d.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')

/** Correo interno para el equipo (contacto@ + BCC ventas@). */
export function buildPqrsInternalEmail(d: PqrsEmailData): { subject: string, text: string, html: string } {
  const rows: [string, string][] = [
    ['Motivo', d.motivo],
    ['Nombre', `${d.nombre} ${d.apellido}`],
    ['Correo', d.email],
    ['Teléfono', d.telefono],
    ['Mensaje', d.mensaje],
    ['Fecha', d.fecha],
  ]
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;">
      <div style="background:${C.purple};color:${C.white};padding:14px 18px;border-radius:10px 10px 0 0;font-size:16px;font-weight:bold;">
        Nueva PQRS — ${esc(d.motivo)}
      </div>
      <table style="border-collapse:collapse;border:1px solid ${C.line};border-top:0;width:100%;max-width:640px;">
        ${rows.map(([k, v]) => `
        <tr>
          <td style="padding:8px 14px;font-weight:bold;vertical-align:top;color:${C.ink};white-space:nowrap;border-bottom:1px solid ${C.line};">${k}</td>
          <td style="padding:8px 14px;color:${C.ink};border-bottom:1px solid ${C.line};">${esc(v).replace(/\n/g, '<br>')}</td>
        </tr>`).join('')}
      </table>
    </div>`
  return {
    subject: `PQRS — ${d.motivo} — ${d.nombre} ${d.apellido}`,
    text,
    html,
  }
}

/** Acuse de recibo para el cliente ("recibimos tu solicitud"), con marca. */
export function buildPqrsAckEmail(d: PqrsEmailData): { subject: string, text: string, html: string } {
  const b = base(d)
  const text = [
    `Hola ${d.nombre},`,
    '',
    `Recibimos tu solicitud (${d.motivo}) el ${d.fecha}. Nuestro equipo la revisará y te responderemos a este correo lo antes posible.`,
    '',
    'Tu mensaje:',
    d.mensaje,
    '',
    `¿Es urgente? Escríbenos por WhatsApp al ${WHATSAPP_NUM} (${HOURS}).`,
    '',
    'Kustom Disfraces — Disfraces para cada historia',
  ].join('\n')

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>Recibimos tu solicitud — Kustom Disfraces</title>
</head>
<body style="margin:0;padding:0;background:${C.crema};-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.crema};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.white};border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(17,17,17,0.08);">

          <!-- ===== HEADER (morado) ===== -->
          <tr>
            <td align="center" style="background:${C.purple};padding:28px 24px 24px;">
              <img src="${b}/images/email/logo.png" width="52" height="52" alt="Kustom" style="display:block;margin:0 auto 8px;width:52px;height:52px;border-radius:12px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;letter-spacing:2px;color:${C.white};">KUSTOM</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.purpleSoft};margin-top:2px;">Disfraces y Trajes típicos</div>
            </td>
          </tr>

          <!-- ===== HERO (KO) ===== -->
          <tr>
            <td align="center" style="padding:28px 28px 4px;">
              <img src="${b}/images/email/ko-paz.png" width="150" alt="" style="display:block;margin:0 auto 6px;width:150px;height:auto;">
              <h1 style="margin:10px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;color:${C.ink};">¡Recibimos tu solicitud!</h1>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#555;">
                Hola${d.nombre ? `, ${esc(d.nombre)}` : ''}. Tu mensaje ya está en manos de nuestro equipo:
                lo revisaremos y te responderemos a este correo lo antes posible.
              </p>
            </td>
          </tr>

          <!-- ===== RESUMEN ===== -->
          <tr>
            <td style="padding:20px 28px 8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding-bottom:6px;">Tu solicitud</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.crema};border-radius:12px;">
                <tr><td style="padding:14px 16px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#888;">Motivo</td></tr>
                <tr><td style="padding:0 16px 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${C.ink};">${esc(d.motivo)}</td></tr>
                <tr><td style="padding:0 16px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#888;">Fecha</td></tr>
                <tr><td style="padding:0 16px 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${C.ink};">${esc(d.fecha)}</td></tr>
                <tr><td style="padding:0 16px 4px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#888;">Mensaje</td></tr>
                <tr><td style="padding:0 16px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${C.ink};">${esc(d.mensaje).replace(/\n/g, '<br>')}</td></tr>
              </table>
            </td>
          </tr>

          <!-- ===== AYUDA ===== -->
          <tr>
            <td align="center" style="padding:14px 28px 26px;">
              <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.5;color:#777;">
                ¿Es urgente? Escríbenos por WhatsApp — ${HOURS}
              </p>
              <a href="${WHATSAPP_URL}" style="display:inline-block;background:${C.purple};color:${C.white};font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:999px;">WhatsApp ${WHATSAPP_NUM}</a>
            </td>
          </tr>

          <!-- ===== FOOTER ===== -->
          <tr>
            <td align="center" style="background:${C.ink};padding:18px 24px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${C.muted};">
                © 2026 Kustom Disfraces · Bogotá, Colombia · Disfraces para cada historia
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return {
    subject: 'Recibimos tu solicitud — Kustom Disfraces',
    text,
    html,
  }
}
