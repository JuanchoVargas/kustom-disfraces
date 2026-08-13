import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook de Mercado Pago (Fase 2, sandbox). MP lo llama server-to-server cuando
 * cambia el estado de un pago. NO confiamos en el contenido de la notificación:
 * consultamos la API de MP (GET /v1/payments/{id}) con el Access Token para leer
 * el estado REAL del pago.
 *
 * Seguridad:
 *  1. Si hay MP_WEBHOOK_SECRET, se valida la firma HMAC (x-signature) y se
 *     rechazan notificaciones no auténticas (401).
 *  2. El estado se confirma contra la API de MP, no contra el body recibido.
 *
 * Responde SIEMPRE rápido: 200 cuando se procesó, 500 solo si falló la consulta
 * (para que MP reintente). MP necesita una URL PÚBLICA — en localhost no llega
 * (por eso el endpoint de la preferencia solo registra notification_url fuera de local).
 *
 * NOTA: aún no hay sistema de pedidos/BD. Por ahora el webhook VERIFICA y LOGguea
 * el estado; el punto de enganche para persistir/confirmar el pedido queda marcado.
 */

interface MpPaymentItem {
  id?: string           // = SKU (lo pusimos como item.id en la preferencia)
  title?: string
  quantity?: string | number
  unit_price?: string | number
}
interface MpPayment {
  id: number
  status: string        // approved | rejected | pending | in_process | cancelled | refunded...
  status_detail: string
  transaction_amount: number
  external_reference?: string
  payer?: { email?: string, first_name?: string, last_name?: string }
  additional_info?: { items?: MpPaymentItem[] }
}

/** Valida la firma x-signature de MP (HMAC-SHA256). Ver docs "Validar origen". */
function isValidSignature(opts: {
  secret: string
  signatureHeader: string | undefined
  requestId: string | undefined
  dataId: string
}): boolean {
  const { secret, signatureHeader, requestId, dataId } = opts
  if (!signatureHeader) return false

  // x-signature: "ts=1704908010,v1=abcdef..."
  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => kv.split('=').map(s => s.trim()) as [string, string]),
  )
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  // Manifest exacto que exige MP (data.id en minúsculas si es alfanumérico).
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ''};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')

  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(v1, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export default defineEventHandler(async (event) => {
  const { mpAccessToken, mpWebhookSecret } = useRuntimeConfig()
  const query = getQuery(event)
  const body = await readBody<{ type?: string, action?: string, data?: { id?: string | number } }>(event).catch(() => ({}))

  // El tipo y el id del recurso pueden llegar por body (Webhooks v2) o por query
  // (IPN legacy: ?topic=payment&id= / ?type=payment&data.id=).
  const type = String(body?.type || query.type || query.topic || '')
  const dataId = String(body?.data?.id || query['data.id'] || query.id || '')

  // Solo nos interesan notificaciones de pago; el resto se acusa con 200 y se ignora.
  if (type !== 'payment' || !dataId) {
    return { received: true, ignored: true }
  }

  // ---------- 1) validar firma si hay secreto ----------
  if (mpWebhookSecret) {
    const ok = isValidSignature({
      secret: mpWebhookSecret,
      signatureHeader: getHeader(event, 'x-signature'),
      requestId: getHeader(event, 'x-request-id'),
      dataId,
    })
    if (!ok) {
      console.warn('[mp-webhook] firma inválida — notificación rechazada')
      throw createError({ statusCode: 401, message: 'Firma inválida' })
    }
  }
  else {
    console.warn('[mp-webhook] MP_WEBHOOK_SECRET no configurado — se omite validación de firma')
  }

  // ---------- 2) verificar el estado REAL contra la API de MP ----------
  if (!mpAccessToken) {
    // Sin token no podemos verificar; acusamos recibo para no forzar reintentos.
    console.error('[mp-webhook] sin MP_ACCESS_TOKEN — no se pudo verificar el pago', dataId)
    return { received: true, verified: false }
  }

  let payment: MpPayment
  try {
    payment = await $fetch<MpPayment>(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    })
  }
  catch (err) {
    // Fallo al consultar la API: devolvemos 500 para que MP reintente más tarde.
    console.error('[mp-webhook] no se pudo consultar el pago en MP:', String((err as Error)?.message ?? err))
    throw createError({ statusCode: 500, message: 'No se pudo verificar el pago' })
  }

  // Estado real y confiable del pago.
  console.info(
    `[mp-webhook] pago ${payment.id}: ${payment.status} (${payment.status_detail}) — `
    + `$${payment.transaction_amount} ref=${payment.external_reference ?? '-'}`,
  )

  // Solo un pago APROBADO genera orden. rejected/cancelled/pending -> solo se registra.
  if (payment.status !== 'approved') {
    return { received: true, verified: true, status: payment.status }
  }

  // ---------- 3) crear la orden en WooCommerce (idempotente) ----------
  if (!wooOrdersConfigured()) {
    console.warn(`[mp-webhook] Woo (escritura) sin configurar — pago APROBADO ${payment.id} registrado SIN crear orden`)
    return { received: true, verified: true, status: payment.status, orderCreated: false, reason: 'woo_not_configured' }
  }

  const orderItems = (payment.additional_info?.items ?? []).map(it => ({
    sku: it.id ? String(it.id) : undefined,
    title: String(it.title ?? 'Producto'),
    quantity: Math.max(1, Math.trunc(Number(it.quantity) || 1)),
    unitPrice: Number(it.unit_price) || 0,
  }))

  try {
    // Idempotencia: si ya existe una orden para este pago, no se crea otra.
    const existing = await findWooOrderByPaymentId(String(payment.id))
    if (existing) {
      console.info(`[mp-webhook] orden ya existía para el pago ${payment.id} (Woo #${existing.id}) — no se duplica`)
      return { received: true, verified: true, status: payment.status, orderId: existing.id, duplicate: true }
    }

    const order = await createWooOrder({
      paymentId: String(payment.id),
      payerFirstName: payment.payer?.first_name,
      payerLastName: payment.payer?.last_name,
      payerEmail: payment.payer?.email,
      items: orderItems,
      amount: payment.transaction_amount,
    })
    console.info(`[mp-webhook] orden creada en Woo #${order.id} (pago ${payment.id}, ${payment.status})`)
    return { received: true, verified: true, status: payment.status, orderId: order.id }
  }
  catch (err) {
    // Woo falló: NO perder el pago — se registra con todos los datos para recuperarlo a mano.
    console.error(
      `[mp-webhook] Woo no respondió — pago APROBADO SIN orden. Recuperar manualmente. `
      + `paymentId=${payment.id} monto=$${payment.transaction_amount} `
      + `pagador=${payment.payer?.email ?? '-'} `
      + `items=${JSON.stringify(orderItems)} `
      + `causa=${sanitizeWooOrderError(err)}`,
    )
    // 500 -> MP reintenta más tarde; al recuperarse Woo, la idempotencia evita duplicar.
    throw createError({ statusCode: 500, message: 'Pago verificado pero no se pudo crear la orden' })
  }
})
