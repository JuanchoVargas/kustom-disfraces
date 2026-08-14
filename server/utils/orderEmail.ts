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

// Content-IDs de las imágenes fijas incrustadas (deben coincidir en HTML y adjuntas).
const INLINE_CID = { logo: 'logo', ko: 'ko' }

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
  /** 'customer' = confirmación al comprador · 'sales' = aviso al negocio. Default customer. */
  audience?: 'customer' | 'sales'
  /** 'url' = imágenes por URL remota (preview) · 'cid' = incrustadas inline (envío real). Default url. */
  imageMode?: 'url' | 'cid'
}

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Construye el HTML del correo (función pura — también sirve para previsualizar). */
export function buildOrderEmailHtml(data: OrderEmailData): string {
  const base = (data.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  const saludo = data.buyerName ? `, ${esc(data.buyerName)}` : ''
  const isSales = data.audience === 'sales'

  // Resolución de imágenes: 'url' (remota, para previsualizar) o 'cid' (incrustada
  // inline en el envío real, así se ven sin "cargar imágenes"). Keys: 'logo', 'ko',
  // 'p:<slug>'. Los cid deben coincidir con los de las adjuntas (ver INLINE_CID).
  const cidMode = data.imageMode === 'cid'
  const imgSrc = (key: string): string => {
    if (key === 'logo') return cidMode ? `cid:${INLINE_CID.logo}` : `${base}/images/email/logo.png`
    if (key === 'ko') return cidMode ? `cid:${INLINE_CID.ko}` : `${base}/images/email/ko-paz.png`
    const slug = key.slice(2) // 'p:<slug>'
    return cidMode ? `cid:p-${slug}` : `${base}/images/email/products/${slug}.jpg`
  }

  // El encabezado cambia según a quién va: cliente (confirmación) o negocio (aviso de venta).
  const heroTitle = isSales ? '🛍️ ¡Nueva venta!' : '¡Pago recibido! 🎉'
  const heroSub = isSales
    ? `Pedido pagado${data.buyerName ? ` de ${esc(data.buyerName)}` : ''}. Coordina el envío con el cliente.`
    : `Gracias por tu compra${saludo}. Ya estamos preparando tu pedido.`
  const sectionLabel = isSales ? 'Detalle del pedido' : 'Tu pedido'
  // En el aviso de venta se muestran los datos de contacto del comprador.
  const buyerBlock = (isSales && (data.buyerName || data.buyerEmail))
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#555;margin-top:6px;">Cliente: <strong>${esc(data.buyerName || '—')}</strong>${data.buyerEmail ? ` · <a href="mailto:${esc(data.buyerEmail)}" style="color:${C.purple};text-decoration:none;">${esc(data.buyerEmail)}</a>` : ''}</div>`
    : ''

  const rows = data.items.map((it) => {
    // JPG fondo blanco (no WebP transparente): evita el recuadro negro en clientes de correo.
    const photo = it.slug ? imgSrc(`p:${it.slug}`) : ''
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
              <img src="${imgSrc('logo')}" width="52" height="52" alt="Kustom" style="display:block;margin:0 auto 8px;width:52px;height:52px;border-radius:12px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;letter-spacing:2px;color:${C.white};">KUSTOM</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.purpleSoft};margin-top:2px;">Disfraces y Trajes típicos</div>
            </td>
          </tr>

          <!-- ===== HERO (KO celebrando) ===== -->
          <tr>
            <td align="center" style="padding:28px 28px 4px;">
              <img src="${imgSrc('ko')}" width="150" alt="KO celebrando tu compra" style="display:block;margin:0 auto 6px;width:150px;height:auto;">
              <h1 style="margin:10px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;color:${C.ink};">${heroTitle}</h1>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#555;">
                ${heroSub}
              </p>
            </td>
          </tr>

          <!-- ===== PRODUCTOS ===== -->
          <tr>
            <td style="padding:20px 28px 4px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};padding-bottom:4px;">${sectionLabel}</div>
              ${buyerBlock}
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
  const isSales = data.audience === 'sales'
  const lines = data.items.map(it => `- ${it.name} (Talla ${it.talla}) x${it.quantity}  ${formatCOP(it.unitPrice * it.quantity)}`)
  return [
    isSales ? '🛍️ Nueva venta en Kustom Disfraces.' : '¡Pago recibido! Gracias por tu compra en Kustom Disfraces.',
    '',
    ...(isSales && (data.buyerName || data.buyerEmail) ? [`Cliente: ${data.buyerName ?? '—'}${data.buyerEmail ? ` <${data.buyerEmail}>` : ''}`, ''] : []),
    isSales ? 'Detalle del pedido:' : 'Tu pedido:',
    ...lines,
    '',
    `Total pagado: ${formatCOP(data.total)}`,
    `Referencia de pago Mercado Pago: #${data.paymentId}`,
    '',
    'Coordinar el envío por WhatsApp.',
    `WhatsApp: ${WHATSAPP_NUM} (${WHATSAPP_URL})`,
    `Correo: ${BUSINESS_EMAIL}`,
    `Horario: ${HOURS}`,
  ].join('\n')
}

const isEmail = (v?: string): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

interface InlineAttachment { filename: string, content: Buffer, cid: string }

/**
 * Descarga las imágenes del correo (logo, KO y las fotos de los productos del
 * pedido) desde su URL pública y las devuelve como adjuntas inline (cid) para
 * INCRUSTARLAS en el correo — así se ven sin "cargar imágenes" en cualquier
 * cliente (Roundcube/Outlook incluidos). Si algo falla, devuelve null y el envío
 * cae a imágenes por URL remota (comportamiento anterior).
 */
async function fetchInlineAttachments(data: OrderEmailData): Promise<InlineAttachment[] | null> {
  const base = (data.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  const slugs = [...new Set(data.items.map(i => i.slug).filter((s): s is string => !!s))]
  const specs = [
    { cid: INLINE_CID.logo, filename: 'logo.png', url: `${base}/images/email/logo.png` },
    { cid: INLINE_CID.ko, filename: 'ko-paz.png', url: `${base}/images/email/ko-paz.png` },
    ...slugs.map(s => ({ cid: `p-${s}`, filename: `${s}.jpg`, url: `${base}/images/email/products/${s}.jpg` })),
  ]
  try {
    return await Promise.all(specs.map(async sp => ({
      filename: sp.filename,
      cid: sp.cid,
      content: Buffer.from(await $fetch<ArrayBuffer>(sp.url, { responseType: 'arrayBuffer' })),
    })))
  }
  catch (err) {
    console.warn(`[order-email] no se pudieron incrustar imágenes (se usan URLs remotas):`, String((err as Error)?.message ?? err))
    return null
  }
}

/**
 * Envía dos correos: (1) AVISO DE VENTA al negocio (siempre, a ventas@ — su propio
 * correo, NO bcc, para que llegue fiable al buzón de ventas), y (2) CONFIRMACIÓN al
 * cliente (si MP dio su email). Las imágenes van INCRUSTADAS (cid) para que se vean
 * sin "cargar imágenes". NO lanza: registra cualquier fallo y sigue — el pago y la
 * orden ya quedaron guardados (Fase 4, req 5).
 */
export async function sendOrderConfirmationEmail(
  data: OrderEmailData,
): Promise<{ sent: boolean, salesSent: boolean, customerSent: boolean, salesTo?: string, reason?: string }> {
  if (!mailerConfigured()) {
    console.warn(`[order-email] SMTP sin configurar — no se envía correo del pago ${data.paymentId}`)
    return { sent: false, salesSent: false, customerSent: false, reason: 'smtp_not_configured' }
  }

  const c = useRuntimeConfig()
  const from = c.smtpFrom || c.smtpUser
  const salesTo = c.ventasTo || 'ventas@disfraceskustom.com' // buzón de ventas (configurable)
  const buyer = isEmail(data.buyerEmail) ? data.buyerEmail : undefined
  const transporter = createMailTransport()
  const senderFrom = `"Kustom Disfraces" <${from}>`

  // Imágenes incrustadas (una sola descarga, se reutiliza en ambos correos).
  const attachments = await fetchInlineAttachments(data)
  const imageMode: 'url' | 'cid' = attachments ? 'cid' : 'url'
  const withImages = <T extends object>(m: T) => (attachments ? { ...m, attachments } : m)
  console.info(`[order-email] imágenes=${imageMode}${attachments ? ` (${attachments.length} incrustadas)` : ''} (pago ${data.paymentId})`)

  // (1) AVISO DE VENTA -> ventas@ (correo dedicado, destinatario distinto del remitente)
  let salesSent = false
  try {
    await transporter.sendMail(withImages({
      from: senderFrom,
      to: salesTo,
      replyTo: buyer, // responder al aviso escribe al cliente
      subject: `🛍️ Nueva venta — Pedido #${data.paymentId}`,
      text: buildOrderEmailText({ ...data, audience: 'sales' }),
      html: buildOrderEmailHtml({ ...data, audience: 'sales', imageMode }),
    }))
    salesSent = true
    console.info(`[order-email] aviso de venta enviado a ${salesTo} (pago ${data.paymentId})`)
  }
  catch (err) {
    console.error(`[order-email] fallo al enviar el aviso de venta a ${salesTo} (pago ${data.paymentId}):`, String((err as Error)?.message ?? err))
  }

  // (2) CONFIRMACIÓN al cliente (si hay email)
  let customerSent = false
  if (buyer) {
    try {
      await transporter.sendMail(withImages({
        from: senderFrom,
        to: buyer,
        subject: '¡Pago recibido! Tu pedido en Kustom Disfraces 🎉',
        text: buildOrderEmailText({ ...data, audience: 'customer' }),
        html: buildOrderEmailHtml({ ...data, audience: 'customer', imageMode }),
      }))
      customerSent = true
      console.info(`[order-email] confirmación enviada al cliente ${buyer} (pago ${data.paymentId})`)
    }
    catch (err) {
      console.error(`[order-email] fallo al enviar la confirmación al cliente ${buyer} (pago ${data.paymentId}):`, String((err as Error)?.message ?? err))
    }
  }

  return { sent: salesSent || customerSent, salesSent, customerSent, salesTo }
}
