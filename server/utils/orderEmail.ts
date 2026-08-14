import { formatCOP } from '~~/shared/utils/format'
import { createMailTransport, mailerConfigured } from './mailer'

/**
 * Correo de confirmación de pago con identidad de marca Kustom (Fase 4).
 * HTML con estilos INLINE (Gmail no lee <style> externos) e imágenes por URL
 * absoluta a https://www.disfraceskustom.com/... El envío usa el SMTP compartido.
 */

const BUSINESS_EMAIL = 'contacto@disfraceskustom.com'
const WHATSAPP_URL = 'https://wa.me/573144477210'
const WHATSAPP_NUM = '314 447 7210'
const HOURS = 'Lunes a sábado, 8:00 a.m. a 7:00 p.m.'

// Paleta de marca (valores literales — el correo no puede leer los tokens del sitio)
const C = {
  purple: '#7E57C2',
  purpleSoft: '#EADDF7',
  ink: '#111111',
  crema: '#F7F6F2',
  muted: '#A7A49D',
  line: '#E7E4DE',
  white: '#FFFFFF',
  wa: '#25D366',
}

const SOCIAL = [
  { label: 'Instagram', href: 'https://www.instagram.com/disfraceskustom/' },
  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61591282154264' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@disfraceskustom' },
  { label: 'WhatsApp', href: WHATSAPP_URL },
]

export interface OrderEmailItem {
  name: string
  talla: string
  quantity: number
  unitPrice: number
  slug?: string
}
export interface OrderEmailData {
  paymentId: string
  buyerName?: string
  buyerEmail?: string
  items: OrderEmailItem[]
  total: number
  /** Base pública para las imágenes (default: sitio canónico). */
  siteUrl?: string
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Construye el HTML del correo (función pura — también sirve para previsualizar). */
export function buildOrderEmailHtml(data: OrderEmailData): string {
  const base = (data.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  const saludo = data.buyerName ? `, ${esc(data.buyerName)}` : ''

  const rows = data.items.map((it) => {
    // JPG fondo blanco (no WebP transparente): evita el recuadro negro en clientes de correo.
    const photo = it.slug ? `${base}/images/email/products/${it.slug}.jpg` : ''
    const lineTotal = formatCOP(it.unitPrice * it.quantity)
    const img = photo
      ? `<img src="${photo}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;border:1px solid ${C.line};object-fit:cover;background:${C.white};">`
      : `<div style="width:56px;height:56px;border-radius:8px;border:1px solid ${C.line};background:${C.crema};"></div>`
    return `
      <tr>
        <td valign="top" width="72" style="padding:12px 0;">${img}</td>
        <td valign="top" style="padding:12px 0;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:14px;font-weight:bold;color:${C.ink};line-height:1.3;">${esc(it.name)}</div>
          <div style="font-size:12px;color:#777;margin-top:3px;">Talla ${esc(it.talla)} · Cantidad ${it.quantity}</div>
        </td>
        <td valign="top" align="right" width="96" style="padding:12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${C.ink};white-space:nowrap;">${lineTotal}</td>
      </tr>
      <tr><td colspan="3" style="border-bottom:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>`
  }).join('')

  const socialLinks = SOCIAL.map(s =>
    `<a href="${s.href}" style="color:${C.muted};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${s.label}</a>`,
  ).join(`<span style="color:#4A4843;">&nbsp;&nbsp;·&nbsp;&nbsp;</span>`)

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>¡Pago recibido! — Kustom Disfraces</title>
</head>
<body style="margin:0;padding:0;background:${C.crema};-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.crema};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.white};border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(17,17,17,0.08);">

          <!-- ===== HEADER (morado) ===== -->
          <tr>
            <td align="center" style="background:${C.purple};padding:28px 24px 24px;">
              <img src="${base}/images/email/logo.png" width="52" height="52" alt="Kustom" style="display:block;margin:0 auto 8px;width:52px;height:52px;border-radius:12px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;letter-spacing:2px;color:${C.white};">KUSTOM</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.purpleSoft};margin-top:2px;">Disfraces y Trajes típicos</div>
            </td>
          </tr>

          <!-- ===== HERO (KO celebrando) ===== -->
          <tr>
            <td align="center" style="padding:28px 28px 4px;">
              <img src="${base}/images/email/ko-paz.png" width="150" alt="KO celebrando tu compra" style="display:block;margin:0 auto 6px;width:150px;height:auto;">
              <h1 style="margin:10px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;color:${C.ink};">¡Pago recibido! 🎉</h1>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#555;">
                Gracias por tu compra${saludo}. Ya estamos preparando tu pedido.
              </p>
            </td>
          </tr>

          <!-- ===== PRODUCTOS ===== -->
          <tr>
            <td style="padding:20px 28px 4px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding-bottom:4px;">Tu pedido</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows}
              </table>
            </td>
          </tr>

          <!-- ===== TOTAL + REFERENCIA ===== -->
          <tr>
            <td style="padding:12px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:${C.ink};">Total pagado</td>
                  <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:${C.purple};">${formatCOP(data.total)}</td>
                </tr>
              </table>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888;margin-top:6px;">
                Referencia de pago Mercado Pago: <strong style="color:#555;">#${esc(data.paymentId)}</strong>
              </div>
            </td>
          </tr>

          <!-- ===== ENVÍO / CONTACTO ===== -->
          <tr>
            <td style="padding:12px 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.crema};border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:15px;font-weight:bold;color:${C.ink};">📦 Coordinaremos el envío por WhatsApp</div>
                    <div style="font-size:13px;line-height:1.6;color:#555;margin-top:6px;">
                      Te escribiremos al WhatsApp para confirmar la dirección y los detalles de entrega.
                    </div>
                    <div style="padding:14px 0 6px;">
                      <a href="${WHATSAPP_URL}" style="display:inline-block;background:${C.wa};color:${C.white};font-size:14px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:999px;">Escríbenos por WhatsApp</a>
                    </div>
                    <div style="font-size:12.5px;line-height:1.7;color:#666;margin-top:8px;">
                      WhatsApp: <a href="${WHATSAPP_URL}" style="color:${C.purple};text-decoration:none;">${WHATSAPP_NUM}</a><br>
                      Correo: <a href="mailto:${BUSINESS_EMAIL}" style="color:${C.purple};text-decoration:none;">${BUSINESS_EMAIL}</a><br>
                      Horario: ${HOURS}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ===== FOOTER (carbón, estilo del sitio) ===== -->
          <tr>
            <td align="center" style="background:${C.ink};padding:26px 24px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:1px;color:${C.white};">KUSTOM</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.muted};margin:6px 0 14px;">Disfraces para cada historia</div>
              <div style="margin-bottom:14px;">${socialLinks}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#7A776F;">© 2026 Kustom Disfraces · Hecho con <span style="color:${C.purple};">♥</span> en Bogotá</div>
            </td>
          </tr>

        </table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#B7B4AD;padding:14px 12px 0;max-width:600px;">
          Recibiste este correo porque se registró un pago en disfraceskustom.com.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Versión de texto plano (fallback para clientes sin HTML). */
function buildOrderEmailText(data: OrderEmailData): string {
  const lines = data.items.map(it => `- ${it.name} (Talla ${it.talla}) x${it.quantity}  ${formatCOP(it.unitPrice * it.quantity)}`)
  return [
    '¡Pago recibido! Gracias por tu compra en Kustom Disfraces.',
    '',
    'Tu pedido:',
    ...lines,
    '',
    `Total pagado: ${formatCOP(data.total)}`,
    `Referencia de pago Mercado Pago: #${data.paymentId}`,
    '',
    'Coordinaremos el envío por WhatsApp para confirmar la dirección.',
    `WhatsApp: ${WHATSAPP_NUM} (${WHATSAPP_URL})`,
    `Correo: ${BUSINESS_EMAIL}`,
    `Horario: ${HOURS}`,
  ].join('\n')
}

/**
 * Envía el correo de confirmación. NO lanza: ante cualquier fallo lo registra y
 * devuelve { sent:false } — el pago y la orden ya quedaron guardados (Fase 4, req 5).
 */
export async function sendOrderConfirmationEmail(data: OrderEmailData): Promise<{ sent: boolean, reason?: string }> {
  if (!mailerConfigured()) {
    console.warn(`[order-email] SMTP sin configurar — no se envía correo del pago ${data.paymentId}`)
    return { sent: false, reason: 'smtp_not_configured' }
  }

  const c = useRuntimeConfig()
  const from = c.smtpFrom || c.smtpUser
  const buyer = data.buyerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.buyerEmail) ? data.buyerEmail : undefined

  // Destinatarios: el cliente (si hay email) y SIEMPRE el negocio (copia oculta).
  const to = buyer || BUSINESS_EMAIL
  const bcc = buyer ? BUSINESS_EMAIL : undefined

  try {
    await createMailTransport().sendMail({
      from: `"Kustom Disfraces" <${from}>`,
      to,
      ...(bcc ? { bcc } : {}),
      subject: '¡Pago recibido! Tu pedido en Kustom Disfraces 🎉',
      text: buildOrderEmailText(data),
      html: buildOrderEmailHtml(data),
    })
    console.info(`[order-email] correo enviado (pago ${data.paymentId}) a ${to}${bcc ? ` + bcc ${bcc}` : ''}`)
    return { sent: true }
  }
  catch (err) {
    console.error(`[order-email] fallo al enviar el correo del pago ${data.paymentId}:`, String((err as Error)?.message ?? err))
    return { sent: false, reason: 'send_failed' }
  }
}
