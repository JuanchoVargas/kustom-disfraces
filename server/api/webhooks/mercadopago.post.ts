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
  metadata?: Record<string, unknown>
  order?: { id?: number }
}

/** Mapea la metadata (keys snake_case que puso el endpoint) a los datos del comprador. */
function buyerFromMetadata(md: unknown): CreateOrderBuyer | null {
  const m = md as Record<string, unknown> | null | undefined
  if (!m || typeof m !== 'object') return null
  if (!m.documento && !m.direccion && !m.nombre) return null
  const str = (v: unknown) => (v == null ? undefined : String(v))
  return {
    nombre: str(m.nombre),
    tipoDocumento: str(m.tipo_documento),
    documento: str(m.documento),
    email: str(m.email),
    telefono: str(m.telefono),
    pais: str(m.pais),
    departamento: str(m.departamento),
    ciudad: str(m.ciudad),
    localidad: str(m.localidad),
    barrio: str(m.barrio),
    direccion: str(m.direccion),
    notas: str(m.notas),
  }
}

/**
 * Recupera los datos del comprador (Fase 5). Primero de la metadata del pago;
 * si no viniera ahí, sigue la cadena merchant_order -> preference -> metadata.
 */
async function recoverBuyer(payment: MpPayment, token: string): Promise<CreateOrderBuyer | null> {
  const direct = buyerFromMetadata(payment.metadata)
  if (direct) return direct
  try {
    const moId = payment.order?.id
    if (!moId) return null
    const headers = { Authorization: `Bearer ${token}` }
    const mo = await $fetch<{ preference_id?: string }>(`https://api.mercadopago.com/merchant_orders/${moId}`, { headers })
    if (!mo?.preference_id) return null
    const pref = await $fetch<{ metadata?: unknown }>(`https://api.mercadopago.com/checkout/preferences/${mo.preference_id}`, { headers })
    return buyerFromMetadata(pref?.metadata)
  }
  catch (err) {
    console.warn('[mp-webhook] no se pudo recuperar el comprador vía merchant_order:', String((err as Error)?.message ?? err))
    return null
  }
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

  // ---------- 3) preparar ítems (para la orden Y para la alerta) ----------
  // SEGURIDAD: los precios se recalculan por SKU desde el catálogo del servidor.
  // Se construyen ANTES de tocar Woo para que la alerta los incluya aunque Woo
  // esté caído/sin configurar.
  let priceMap: Awaited<ReturnType<typeof getPriceMapBySku>> | null = null
  try {
    priceMap = await getPriceMapBySku()
  }
  catch (err) {
    console.warn('[mp-webhook] catálogo no disponible para recalcular precios; se usa el monto pagado:', String((err as Error)?.message ?? err))
  }

  const orderItems = (payment.additional_info?.items ?? []).map((it) => {
    const sku = it.id ? String(it.id) : undefined
    const real = sku ? priceMap?.get(sku) : undefined
    const paidPrice = Number(it.unit_price) || 0
    if (real && real.price !== paidPrice) {
      // No debería ocurrir (la preferencia ya usó el precio real); se registra por si acaso.
      console.warn(`[mp-webhook] precio de ${sku} difiere: pagado=${paidPrice} real=${real.price} — se usa el real`)
    }
    const title = String(it.title ?? 'Producto')
    const m = title.match(/^(.*?)\s*\(Talla\s*(.+?)\)\s*$/) // separa nombre y talla del título compuesto
    return {
      sku,
      title, // nombre+talla (línea de la orden en Woo)
      name: real?.name ?? (m ? m[1] : title), // nombre limpio (correo)
      talla: m ? m[2] : '—', // talla (correo)
      slug: real?.slug || undefined, // foto pública (correo)
      quantity: Math.max(1, Math.trunc(Number(it.quantity) || 1)),
      unitPrice: real?.price ?? paidPrice, // ← precio REAL del servidor cuando está disponible
    }
  })

  // Datos del comprador (envío + factura opcional) recuperados de la metadata de
  // la preferencia. Se resuelve ANTES de failWithAlert para que la alerta también
  // incluya los datos de envío si Woo llegara a fallar.
  const buyer = await recoverBuyer(payment, mpAccessToken)
  if (buyer) console.info(`[mp-webhook] comprador recuperado: ${buyer.nombre} · ${buyer.ciudad}/${buyer.departamento} · ${buyer.direccion}`)
  else console.warn(`[mp-webhook] sin datos de comprador en la preferencia del pago ${payment.id} (se crea orden con datos del pagador de MP)`)

  // Fallo al crear la orden (cualquier causa): registra TODO, ALERTA a ventas@ (una
  // vez por paymentId) y responde 5xx para que MP REINTENTE. Así ningún pago pasa
  // desapercibido y un fallo temporal se recupera solo en el próximo reintento.
  const failWithAlert = async (reason: string): Promise<never> => {
    console.error(
      `[mp-webhook] ⚠️ pago APROBADO SIN orden (${reason}). Recuperar. `
      + `paymentId=${payment.id} monto=$${payment.transaction_amount} `
      + `pagador=${payment.payer?.email ?? '-'} items=${JSON.stringify(orderItems)} `
      + `envío=${buyer ? JSON.stringify(buyer) : '-'}`,
    )
    const alert = await sendOrderFailureAlert({
      paymentId: String(payment.id),
      amount: payment.transaction_amount,
      payerName: buyer?.nombre || [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') || undefined,
      payerEmail: buyer?.email || payment.payer?.email,
      items: orderItems.map(i => ({ name: i.name, talla: i.talla, quantity: i.quantity, unitPrice: i.unitPrice })),
      reason,
    })
    console.info(`[mp-webhook] alerta a ventas: ${alert.sent ? 'enviada' : alert.deduped ? 'ya enviada antes (dedupe)' : `no enviada (${alert.reason})`}`)
    throw createError({ statusCode: 503, message: `Pago verificado pero no se pudo crear la orden (${reason})` })
  }

  // ---------- 4) crear la orden en WooCommerce (idempotente) ----------
  if (!wooOrdersConfigured()) {
    await failWithAlert('woo_not_configured') // credenciales de escritura ausentes/mal
  }

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
      buyer: buyer ?? undefined,
    })
    console.info(`[mp-webhook] orden creada en Woo #${order.id} (pago ${payment.id}, ${payment.status})`)

    // Correo de confirmación con marca (Fase 4). Idempotente: solo se envía en esta
    // ruta de orden NUEVA (si el webhook llega otra vez, cae en el `existing` de arriba).
    // No rompe el flujo: sendOrderConfirmationEmail nunca lanza (registra y sigue).
    const emailResult = await sendOrderConfirmationEmail({
      paymentId: String(payment.id),
      buyerName: buyer?.nombre || [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') || undefined,
      buyerEmail: buyer?.email || payment.payer?.email,
      items: orderItems.map(i => ({ name: i.name, talla: i.talla, quantity: i.quantity, unitPrice: i.unitPrice, slug: i.slug })),
      total: payment.transaction_amount,
      shipping: buyer
        ? {
            documento: buyer.documento ? `${buyer.tipoDocumento || 'CC'} ${buyer.documento}` : undefined,
            telefono: buyer.telefono,
            correo: buyer.email,
            pais: buyer.pais,
            departamento: buyer.departamento,
            ciudad: buyer.ciudad,
            localidad: buyer.localidad,
            barrio: buyer.barrio,
            direccion: buyer.direccion,
            notas: buyer.notas,
          }
        : undefined,
    })

    return { received: true, verified: true, status: payment.status, orderId: order.id, emailSent: emailResult.sent }
  }
  catch (err) {
    // Woo falló (caído, timeout, credenciales mal, error en el idempotency check):
    // alerta + 5xx para que MP reintente. La idempotencia evita duplicar al recuperarse.
    await failWithAlert(`woo_error: ${sanitizeWooOrderError(err)}`)
  }
})
