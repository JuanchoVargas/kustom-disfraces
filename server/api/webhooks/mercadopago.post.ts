import { createHmac, timingSafeEqual } from 'node:crypto'
import { construirLineas, leerAnclaje, verificarMontos, type LineaOrden } from '../../utils/mpAnclaje'
import { procesarPagoMp, type DepsPagoMp, type PagoMp } from '../../utils/procesarPagoMp'

/**
 * Webhook de Mercado Pago. MP lo llama server-to-server cuando cambia el estado de
 * un pago. NO confiamos en el contenido de la notificación: consultamos la API de MP
 * (GET /v1/payments/{id}) con el Access Token para leer el estado REAL del pago.
 *
 * Seguridad:
 *  1. Si hay MP_WEBHOOK_SECRET, se valida la firma HMAC (x-signature) y se
 *     rechazan notificaciones no auténticas (401).
 *  2. El estado se confirma contra la API de MP, no contra el body recibido.
 *
 * Este archivo es solo el borde HTTP: valida la firma y arma las dependencias
 * REALES (MP, Woo, correo). La lógica —candado por pago en `pagos_mp`, segunda
 * barrera en Woo, creación, ajuste manual y correos— vive en
 * server/utils/procesarPagoMp.ts, que es lo que ejercita scripts/test-pagos-mp.mjs.
 *
 * Respuestas: 200 procesado / duplicado / pago no aprobado · 409 otra notificación
 * tiene el pago ahora · 500 no se pudo consultar MP · 503 sin base o falló Woo.
 * Con 409, 500 y 503 Mercado Pago reintenta. MP necesita una URL PÚBLICA: en
 * localhost no llega (el checkout solo registra notification_url fuera de local).
 */

interface MpPaymentItem {
  id?: string           // = SKU (lo pusimos como item.id en la preferencia)
  title?: string
  quantity?: string | number
  unit_price?: string | number
}
type MpPayment = PagoMp

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

  // ---------- 3) dependencias reales ----------
  // El pedido (líneas + comprador) se arma UNA vez por petición y lo comparten la
  // creación de la orden y los correos. Nunca lanza: cada paso tiene su respaldo.
  let pedidoMemo: Promise<{ orderItems: LineaOrden[], ajusteMontos: string | null, buyer: CreateOrderBuyer | null }> | null = null
  const pedidoDe = (payment: MpPayment) => pedidoMemo ??= (async () => {
    // SEGURIDAD: los precios se recalculan por SKU desde el catálogo del servidor.
    let priceMap: Awaited<ReturnType<typeof getPriceMapBySku>> | null = null
    try {
      priceMap = await getPriceMapBySku()
    }
    catch (err) {
      console.warn('[mp-webhook] catálogo no disponible para recalcular precios; se usa el monto pagado:', String((err as Error)?.message ?? err))
    }

    // PRECIO ANCLADO (promociones por fecha): la preferencia guardó en metadata
    // kustom_lineas tal como se cobró; si viene, manda sobre el recálculo. Las
    // preferencias anteriores no lo traen y dan exactamente las líneas de antes.
    // Todo el camino anclado es puro (server/utils/mpAnclaje.ts) y va en try/catch:
    // un fallo ahí NUNCA cambia la respuesta a MP; cae al comportamiento anterior y
    // deja motivo de ajuste manual para que ventas lo revise.
    const itemsMp = (payment.additional_info?.items ?? []) as MpPaymentItem[]
    let orderItems: LineaOrden[]
    let ajusteMontos: string | null = null
    try {
      const anclaje = leerAnclaje(payment.metadata)
      const r = construirLineas(itemsMp, priceMap, anclaje, tallaDesdeTitulo)
      orderItems = r.lineas
      for (const adv of r.advertencias) console.info(`[mp-webhook] precio ${adv}`)
      const montos = verificarMontos(orderItems, payment.transaction_amount)
      const ajustes = montos ? [...r.ajustes, montos] : r.ajustes
      ajusteMontos = ajustes.length ? ajustes.join(' · ') : null
    }
    catch (err) {
      // Solo el NOMBRE del error: el mensaje puede traer un trozo del texto procesado
      // (metadata con datos del comprador) y esto va al log y a la nota de Woo.
      orderItems = construirLineas(itemsMp, priceMap, { estado: 'ausente' }, tallaDesdeTitulo).lineas
      ajusteMontos = `error leyendo el precio anclado (${(err as Error)?.name || 'Error'}); se recalculó el precio`
    }
    if (ajusteMontos) console.error(`[mp-webhook] ⚠️ pago ${payment.id}: ${ajusteMontos} — la orden queda marcada como ajuste manual`)

    // Datos del comprador (envío + factura opcional) recuperados de la metadata de la
    // preferencia. Sin nombre ni dirección en el log: van a la orden de Woo y al correo.
    const buyer = await recoverBuyer(payment, mpAccessToken)
    if (buyer) console.info(`[mp-webhook] comprador recuperado para el pago ${payment.id}: destino ${buyer.ciudad}/${buyer.departamento}`)
    else console.warn(`[mp-webhook] sin datos de comprador en la preferencia del pago ${payment.id} (se crea orden con datos del pagador de MP)`)
    return { orderItems, ajusteMontos, buyer }
  })()

  const nombreDe = (payment: MpPayment, buyer: CreateOrderBuyer | null) =>
    buyer?.nombre || [payment.payer?.first_name, payment.payer?.last_name].filter(Boolean).join(' ') || undefined

  const deps: DepsPagoMp = {
    consultarPago: id => $fetch<MpPayment>(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    }),

    // Los errores de Woo traen las llaves en la URL: se redactan ANTES de salir de aquí.
    buscarOrden: async (id) => {
      if (!wooOrdersConfigured()) throw new Error('woo_not_configured') // credenciales de escritura ausentes/mal
      try {
        return await findWooOrderByPaymentId(id)
      }
      catch (err) {
        throw new Error(sanitizeWooOrderError(err))
      }
    },

    crearOrden: async (payment) => {
      const { orderItems, ajusteMontos, buyer } = await pedidoDe(payment)
      try {
        const order = await createWooOrder({
          paymentId: String(payment.id),
          payerFirstName: payment.payer?.first_name,
          payerLastName: payment.payer?.last_name,
          payerEmail: payment.payer?.email,
          items: orderItems,
          amount: payment.transaction_amount,
          buyer: buyer ?? undefined,
          ajusteManual: ajusteMontos ?? undefined,
        })
        const motivo = (l: { sku?: string, talla?: string | null, motivo: string }) => `${l.sku ?? '?'}${l.talla ? ` talla ${l.talla}` : ''}: ${l.motivo}`
        return {
          id: order.id,
          // Ya escritos en la orden al crearla (línea sin enlazar, montos que no cuadran).
          ajustesRegistrados: order.lineasSinEnlazar.map(motivo).concat(ajusteMontos ? [`montos: ${ajusteMontos}`] : []),
          // Detectados al leer la respuesta de Woo: línea resuelta guardada sin su variación.
          ajustesPendientes: order.lineasVariacionPerdida.map(motivo),
        }
      }
      catch (err) {
        throw new Error(sanitizeWooOrderError(err))
      }
    },

    marcarAjuste: async (orderId, motivos) => {
      try {
        await marcarAjusteManualWoo(orderId, motivos)
      }
      catch (err) {
        throw new Error(sanitizeWooOrderError(err))
      }
    },

    enviarCorreos: async (correo) => {
      const payment = correo.pago
      const { orderItems, buyer } = await pedidoDe(payment)
      const comun = {
        paymentId: String(payment.id),
        amount: payment.transaction_amount,
        payerName: nombreDe(payment, buyer),
        payerEmail: buyer?.email || payment.payer?.email,
        items: orderItems.map(i => ({ name: i.name, talla: i.talla, quantity: i.quantity, unitPrice: i.unitPrice })),
      }

      if (correo.tipo === 'fallo') {
        // Para recuperar el pago basta el paymentId: con él se consulta el pago en MP
        // (pagador, envío). Ni el correo ni los datos de envío van al log.
        console.error(
          `[mp-webhook] ⚠️ pago APROBADO SIN orden (${correo.motivo}). Recuperar. `
          + `paymentId=${payment.id} monto=${payment.transaction_amount} `
          + `items=${JSON.stringify(orderItems.map(i => ({ sku: i.sku, talla: i.talla, cantidad: i.quantity })))} `
          + `datosEnvio=${buyer ? 'sí' : 'no'}`,
        )
        const alert = await sendOrderFailureAlert({ ...comun, reason: correo.motivo })
        console.info(`[mp-webhook] alerta a ventas: ${alert.sent ? 'enviada' : alert.deduped ? 'ya enviada antes (dedupe)' : `no enviada (${alert.reason})`}`)
        return { sent: alert.sent }
      }

      if (correo.tipo === 'ajuste_manual') {
        // La orden se creó y el cliente ya pagó; lo que falló es enlazar alguna línea
        // con su variación (Woo NO le descontó stock) o cuadrar los montos.
        const alert = await sendOrderFailureAlert({ ...comun, variante: 'ajuste_manual', orderId: correo.orderId, reason: correo.motivos.join(' · ') })
        return { sent: alert.sent }
      }

      // Confirmación con marca al cliente. sendOrderConfirmationEmail nunca lanza.
      const r = await sendOrderConfirmationEmail({
        paymentId: String(payment.id),
        buyerName: nombreDe(payment, buyer),
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
      return { sent: r.sent }
    },
  }

  // ---------- 4) procesar ----------
  const r = await procesarPagoMp(dataId, deps)
  if (r.status === 200) return r.body
  throw createError({ statusCode: r.status, message: String(r.body.message ?? 'No se pudo procesar el pago') })
})
