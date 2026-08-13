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

interface MpPayment {
  id: number
  status: string        // approved | rejected | pending | in_process | cancelled | refunded...
  status_detail: string
  transaction_amount: number
  external_reference?: string
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

  try {
    const payment = await $fetch<MpPayment>(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    })

    // Estado real y confiable del pago.
    console.info(
      `[mp-webhook] pago ${payment.id}: ${payment.status} (${payment.status_detail}) — `
      + `$${payment.transaction_amount} ref=${payment.external_reference ?? '-'}`,
    )

    // TODO (con sistema de pedidos): según payment.status
    //   approved  -> marcar pedido pagado y disparar preparación/envío
    //   rejected/cancelled -> liberar reserva
    //   pending/in_process -> dejar en espera
    // Hoy (sin BD) solo se verifica y registra.

    return { received: true, verified: true, status: payment.status }
  }
  catch (err) {
    // Fallo al consultar la API: devolvemos 500 para que MP reintente más tarde.
    console.error('[mp-webhook] no se pudo consultar el pago en MP:', String((err as Error)?.message ?? err))
    throw createError({ statusCode: 500, message: 'No se pudo verificar el pago' })
  }
})
