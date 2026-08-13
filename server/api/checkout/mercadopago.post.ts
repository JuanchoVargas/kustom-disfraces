/**
 * Crea una PREFERENCIA de pago en Mercado Pago (Checkout Pro) con los ítems del
 * carrito y devuelve las URLs de checkout. El frontend redirige al comprador a
 * `sandbox_init_point` (Fase 1: PRUEBA) para pagar en la pantalla de Mercado Pago.
 *
 * Seguridad (regla #1): el Access Token es SECRETO y vive solo en runtimeConfig
 * (server). Nunca se serializa al cliente. Sin token -> 503 not_configured
 * (el sitio sigue con el flujo de WhatsApp intacto).
 *
 * FASE 1 (sandbox): los precios llegan del carrito del cliente. Antes de PRODUCCIÓN
 * hay que revalidarlos contra el catálogo en el servidor (no confiar en el cliente).
 */

interface RawItem {
  sku?: unknown
  quantity?: unknown
  /** Precio que ve el cliente — SOLO para detectar manipulación; el server usa el suyo. */
  unit_price?: unknown
  /** Talla y gama elegidas — solo para el título (display); no afectan el precio. */
  size?: unknown
  gama?: unknown
}

interface MpPreferenceItem {
  /** SKU del producto — MP lo devuelve en additional_info.items[].id; el webhook
   *  lo usa para crear la orden en Woo (Fase 3). */
  id?: string
  title: string
  quantity: number
  unit_price: number
  currency_id: 'COP'
  /** Foto pública del disfraz — MP la muestra en "Detalles del pago" (Nivel 1). */
  picture_url?: string
}

interface MpPreferenceResponse {
  id: string
  init_point?: string
  sandbox_init_point?: string
}

/** Redacta el Bearer del Access Token si apareciera en un mensaje de error. */
const sanitizeMpError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { mpAccessToken } = config
  if (!mpAccessToken) {
    // Sin credenciales configuradas: el front cae al fallback (WhatsApp).
    throw createError({
      statusCode: 503,
      message: 'Mercado Pago sin configurar',
      data: { code: 'not_configured' },
    })
  }

  const body = await readBody<{ items?: RawItem[] }>(event)
  const rawItems = Array.isArray(body?.items) ? body!.items : []
  if (!rawItems.length) {
    throw createError({ statusCode: 422, message: 'Carrito vacío' })
  }

  // Las fotos son públicas y estáticas: viven en el sitio canónico (prod), no en
  // el origen de la request (localhost/Preview no las tienen expuestas a MP).
  const siteBase = (config.public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  const pictureFor = (slug: string): string | undefined =>
    /^[a-z0-9-]+$/.test(slug) ? `${siteBase}/images/products/${slug}.webp` : undefined

  // ---------- SEGURIDAD: precios recalculados en el servidor (nunca del cliente) ----------
  // Se ignora el unit_price enviado; el precio real sale del catálogo por SKU. Si un
  // SKU no existe (no vendible) o el precio enviado no coincide -> se RECHAZA todo.
  let priceMap
  try {
    priceMap = await getPriceMapBySku()
  }
  catch (err) {
    console.error('[mercadopago] no se pudo cargar el catálogo para validar precios:', String((err as Error)?.message ?? err))
    throw createError({ statusCode: 502, message: 'No se pudo validar el catálogo' })
  }

  const items: MpPreferenceItem[] = rawItems.map((raw, idx): MpPreferenceItem => {
    const sku = String(raw?.sku ?? '').trim()
    const quantity = Math.trunc(Number(raw?.quantity))
    if (!sku) {
      throw createError({ statusCode: 422, message: `Ítem ${idx + 1} sin SKU`, data: { code: 'missing_sku' } })
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      throw createError({ statusCode: 422, message: `Ítem ${sku} con cantidad inválida`, data: { code: 'invalid_quantity', sku } })
    }

    const real = priceMap.get(sku)
    if (!real) {
      // SKU inexistente o no vendible (sin precio/oculto) -> no se crea la preferencia.
      throw createError({ statusCode: 422, message: `Producto no disponible (${sku})`, data: { code: 'sku_not_found', sku } })
    }

    // Anti-manipulación: si el cliente mandó un precio y NO coincide con el real, se rechaza.
    const clientPrice = Number(raw?.unit_price)
    if (Number.isFinite(clientPrice) && Math.round(clientPrice) !== real.price) {
      console.warn(`[mercadopago] precio manipulado en ${sku}: enviado=${clientPrice} real=${real.price} — rechazado`)
      throw createError({
        statusCode: 422,
        message: 'Los precios cambiaron; recarga el carrito',
        data: { code: 'price_mismatch', sku, sent: Math.round(clientPrice), real: real.price },
      })
    }

    // Título con nombre oficial + talla/gama (display); precio y foto también del servidor.
    const size = String(raw?.size ?? '').trim().slice(0, 40)
    const gama = String(raw?.gama ?? '').trim().slice(0, 60)
    const detail = size ? ` (Talla ${size}${gama ? `, ${gama}` : ''})` : ''
    const picture_url = pictureFor(real.slug)

    return {
      id: sku,
      title: `${real.name}${detail}`,
      quantity,
      unit_price: real.price, // ← precio REAL del servidor, no el del cliente
      currency_id: 'COP',
      ...(picture_url ? { picture_url } : {}),
    }
  })

  // Origen real de la petición (local, preview o prod) para back_urls / notification_url.
  const origin = getRequestURL(event, { xForwardedHost: true }).origin
  const isLocal = /localhost|127\.0\.0\.1/.test(origin)

  const preference = {
    items,
    back_urls: {
      success: `${origin}/pago-exitoso`,
      failure: `${origin}/pago-fallido`,
      pending: `${origin}/pago-pendiente`,
    },
    // auto_return exige una back_url pública válida; MP la rechaza en localhost.
    // En local el comprador vuelve manualmente ("Volver al sitio"); en prod es automático.
    ...(isLocal ? {} : { auto_return: 'approved' }),
    // Webhook de MP: notificación server-to-server del estado real del pago.
    // MP no puede alcanzar localhost, así que solo se registra en entornos públicos
    // (Preview/prod). El handler vive en /api/webhooks/mercadopago.
    ...(isLocal ? {} : { notification_url: `${origin}/api/webhooks/mercadopago` }),
    // Máximo 3 cuotas (Fase 3): la pantalla de pago ya no ofrece hasta 36x.
    payment_methods: {
      installments: 3,
    },
    statement_descriptor: 'KUSTOM',
  }

  try {
    const res = await $fetch<MpPreferenceResponse>('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpAccessToken}` },
      body: preference,
    })
    return {
      id: res.id,
      init_point: res.init_point,
      sandbox_init_point: res.sandbox_init_point,
    }
  }
  catch (err) {
    console.error('[mercadopago] fallo al crear la preferencia:', sanitizeMpError(err))
    throw createError({ statusCode: 502, message: 'No se pudo iniciar el pago' })
  }
})
