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

import { randomUUID } from 'node:crypto'

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

  const body = await readBody<{ items?: RawItem[], buyer?: Record<string, unknown>, dry_run?: unknown }>(event)
  const rawItems = Array.isArray(body?.items) ? body!.items : []
  /**
   * PRUEBA EN SECO. Recorre TODO el camino —comprador, precios contra el servidor,
   * stock, armado de la preferencia— y corta justo antes de llamar a Mercado Pago.
   * Existe porque probar el camino feliz creaba una preferencia real en MP cada vez
   * (no cobra, pero deja basura y no hay pasarela de pruebas en Preview).
   * Los errores (422, 409) se comportan igual que en una compra de verdad.
   */
  const dryRun = body?.dry_run === true
  // GUARDA DEL OVERRIDE DE HORA (NUXT_PROMO_AHORA, solo Preview): con la hora
  // simulada solo se admite dry_run. El Preview tiene credenciales de MP y comparte
  // Woo y Neon con producción: un pago real con precios de otra fecha sería real.
  if (!dryRun && promoOverrideActivo()) {
    console.warn('[mercadopago] pago real rechazado: NUXT_PROMO_AHORA activo (solo dry_run)')
    throw createError({ statusCode: 403, message: 'Este entorno de pruebas no acepta pagos reales', data: { code: 'promo_override' } })
  }
  if (!rawItems.length) {
    throw createError({ statusCode: 422, message: 'Carrito vacío' })
  }
  // COTIZACIÓN: un dry_run SIN comprador solo calcula precios y totales vigentes
  // (lo pide /checkout al cargar y tras un 422 price_mismatch). Con comprador, el
  // dry_run valida todo el camino como una compra real.
  const soloCotizacion = dryRun && (body?.buyer === undefined || body?.buyer === null)

  // ---------- datos del comprador (envío obligatorio + factura opcional) ----------
  // Se validan en el servidor (no solo en el form): sin ellos no se crea la
  // preferencia, así no se puede pagar sin datos de envío. Viajan a la orden vía
  // la metadata de la preferencia, que el webhook recupera al crear la orden en Woo.
  // tipo_documento/documento/notas son OPCIONALES (solo factura electrónica).
  const rawBuyer = body?.buyer ?? {}
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  const buyer = {
    nombre: s(rawBuyer.nombre, 120),
    tipo_documento: (['CC', 'CE', 'NIT'].includes(String(rawBuyer.tipoDocumento)) ? String(rawBuyer.tipoDocumento) : ''),
    documento: s(rawBuyer.documento, 40),
    email: s(rawBuyer.email, 160),
    telefono: s(rawBuyer.telefono, 40),
    pais: s(rawBuyer.pais, 60),
    departamento: s(rawBuyer.departamento, 120),
    ciudad: s(rawBuyer.ciudad, 120),
    localidad: s(rawBuyer.localidad, 120),
    barrio: s(rawBuyer.barrio, 120),
    direccion: s(rawBuyer.direccion, 250),
    notas: s(rawBuyer.notas, 500),
  }
  const missing: string[] = []
  if (!buyer.nombre) missing.push('nombre')
  if (!buyer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) missing.push('email')
  if (!buyer.telefono) missing.push('telefono')
  if (!buyer.pais) missing.push('pais')
  if (!buyer.departamento) missing.push('departamento')
  if (!buyer.ciudad) missing.push('ciudad')
  if (!buyer.localidad) missing.push('localidad')
  if (!buyer.barrio) missing.push('barrio')
  if (!buyer.direccion) missing.push('direccion')
  if (missing.length && !soloCotizacion) {
    throw createError({ statusCode: 422, message: 'Datos de envío incompletos', data: { code: 'buyer_invalid', fields: missing } })
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

  const lineas: { sku: string, size: string, quantity: number, unit_price: number, precio_pleno: number, promo_id: string | null, promo_nombre: string | null }[] = []
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
    // Línea cotizada (para el dry_run y el anclaje del precio): lo que se cobra hoy y por qué.
    lineas.push({ sku, size, quantity, unit_price: real.price, precio_pleno: real.precioPleno, promo_id: real.promoId, promo_nombre: real.promoNombre })

    return {
      id: sku,
      title: `${real.name}${detail}`,
      quantity,
      unit_price: real.price, // ← precio REAL del servidor, no el del cliente
      currency_id: 'COP',
      ...(picture_url ? { picture_url } : {}),
    }
  })

  // ---------- STOCK (módulo de inventario): validación contra el adaptador ----------
  // Una talla con gestión de stock activa y existencias insuficientes bloquea el
  // pago con 409 sin_stock (el front muestra qué ajustar). Tallas sin gestionar o
  // stock no aplicable al sitio (NUXT_INVENTORY_PUBLIC_STOCK) → pasa como antes.
  const stockProblems = await checkStockFor(rawItems.map(raw => ({
    sku: String(raw?.sku ?? '').trim(),
    size: raw?.size === undefined || raw?.size === null ? null : String(raw.size).trim(),
    quantity: Math.trunc(Number(raw?.quantity)) || 0,
  })))
  if (stockProblems.length) {
    console.warn('[mercadopago] sin stock:', JSON.stringify(stockProblems))
    throw createError({
      statusCode: 409,
      message: 'Algunas tallas ya no tienen existencias',
      data: { code: 'sin_stock', items: stockProblems },
    })
  }

  // Origen real de la petición (local, preview o prod) para las back_urls: el comprador
  // vuelve a donde estaba. La notification_url NO sale de aquí (ver más abajo).
  const origin = getRequestURL(event, { xForwardedHost: true }).origin
  const isLocal = /localhost|127\.0\.0\.1/.test(origin)

  // Nombre para MP (prefill) y para billing en Woo.
  const [firstName, ...restName] = buyer.nombre.split(/\s+/)
  const externalRef = `kustom-${randomUUID()}`

  const preference = {
    items,
    // Prefill de MP con el comprador (email/nombre) — mejora la pantalla de pago.
    payer: { name: firstName, surname: restName.join(' '), email: buyer.email },
    // VÍA de los datos a la orden: metadata de la preferencia. El webhook la
    // recupera (payment.metadata o merchant_order -> preference) al crear la orden.
    // PRECIO ANCLADO: kustom_lineas guarda [sku, talla, cantidad, precio unitario,
    // promo] por línea tal como se COBRÓ (con la promoción por fecha vigente al
    // crear la preferencia). El webhook usa esos precios para la línea de Woo en vez
    // de recalcular: si la promoción termina entre el pago y la notificación, la
    // orden sigue reflejando lo que el cliente pagó (server/utils/mpAnclaje.ts).
    metadata: {
      ...buyer,
      kustom_lineas: JSON.stringify(lineas.map(l => [l.sku, l.size, l.quantity, l.unit_price, l.promo_id ?? ''])),
      kustom_total: items.reduce((n, it) => n + it.unit_price * it.quantity, 0),
    },
    external_reference: externalRef,
    back_urls: {
      success: `${origin}/pago-exitoso`,
      failure: `${origin}/pago-fallido`,
      pending: `${origin}/pago-pendiente`,
    },
    // auto_return exige una back_url pública válida; MP la rechaza en localhost.
    // En local el comprador vuelve manualmente ("Volver al sitio"); en prod es automático.
    ...(isLocal ? {} : { auto_return: 'approved' }),
    // Webhook de MP: notificación server-to-server del estado real del pago.
    // MP no puede alcanzar localhost, así que solo se registra en entornos públicos.
    // SIEMPRE al dominio CANÓNICO (siteBase), nunca al host de la petición: el
    // dominio raíz responde 308 hacia www (MP no sigue redirecciones en un POST) y la
    // URL de un Preview está detrás de la protección de Vercel (MP recibiría 401 y el
    // pago aprobado se quedaría sin orden). Preview y producción comparten Woo y Neon,
    // así que quien procesa el pago es siempre el despliegue de producción.
    ...(isLocal ? {} : { notification_url: `${siteBase}/api/webhooks/mercadopago` }),
    // Máximo 3 cuotas (Fase 3): la pantalla de pago ya no ofrece hasta 36x.
    payment_methods: {
      installments: 3,
    },
    statement_descriptor: 'KUSTOM',
  }

  // Aquí acaba la prueba en seco: todo lo de arriba ya se validó y la preferencia
  // está armada, pero no se envía. No se crea nada en Mercado Pago.
  if (dryRun) {
    console.warn(`[mercadopago] dry_run${soloCotizacion ? ' (cotización)' : ''}: preferencia NO creada (${items.length} ítem(s), ref ${externalRef})`)
    return {
      dry_run: true,
      cotizacion: soloCotizacion,
      id: null,
      checkout_url: null,
      external_reference: externalRef,
      // Lo que se habría mandado, para poder revisarlo sin tocar MP.
      items: preference.items,
      // Precio vigente por línea (con la promoción por fecha si aplica): el checkout
      // lo usa para refrescar el carrito y mandarlo como unit_price al pagar.
      lineas,
      total: items.reduce((n, it) => n + it.unit_price * it.quantity, 0),
    }
  }

  try {
    const res = await $fetch<MpPreferenceResponse>('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mpAccessToken}` },
      body: preference,
    })
    // El servidor elige la URL de pago según el tipo de credencial:
    //  - TEST-...  (prueba)     -> sandbox_init_point (pantalla con watermark "Sandbox")
    //  - APP_USR-  (producción) -> init_point (pantalla real, sin "Sandbox")
    // sandbox_init_point es SIEMPRE sandbox aunque el token sea de producción; por eso
    // no se puede usar como default. Cualquier prefijo que no sea TEST- se trata como prod.
    const isTest = mpAccessToken.startsWith('TEST-')
    const checkout_url = isTest
      ? (res.sandbox_init_point || res.init_point)
      : (res.init_point || res.sandbox_init_point)
    return {
      id: res.id,
      checkout_url,
      init_point: res.init_point,
      sandbox_init_point: res.sandbox_init_point,
    }
  }
  catch (err) {
    console.error('[mercadopago] fallo al crear la preferencia:', sanitizeMpError(err))
    throw createError({ statusCode: 502, message: 'No se pudo iniciar el pago' })
  }
})
