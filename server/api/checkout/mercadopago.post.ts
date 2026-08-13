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
  title?: unknown
  quantity?: unknown
  unit_price?: unknown
}

interface MpPreferenceItem {
  title: string
  quantity: number
  unit_price: number
  currency_id: 'COP'
}

interface MpPreferenceResponse {
  id: string
  init_point?: string
  sandbox_init_point?: string
}

const clean = (v: unknown, max = 250) => String(v ?? '').trim().slice(0, max)

/** Redacta el Bearer del Access Token si apareciera en un mensaje de error. */
const sanitizeMpError = (err: unknown): string =>
  String((err as Error)?.message ?? err).replace(/Bearer\s+[^\s"']+/gi, 'Bearer ***')

export default defineEventHandler(async (event) => {
  const { mpAccessToken } = useRuntimeConfig()
  if (!mpAccessToken) {
    // Sin credenciales configuradas: el front cae al fallback (WhatsApp).
    throw createError({
      statusCode: 503,
      message: 'Mercado Pago sin configurar',
      data: { code: 'not_configured' },
    })
  }

  const body = await readBody<{ items?: RawItem[] }>(event)

  // ---------- validación server-side (no confiar en el cliente) ----------
  const items: MpPreferenceItem[] = (Array.isArray(body?.items) ? body!.items : [])
    .map((raw): MpPreferenceItem | null => {
      const title = clean(raw?.title)
      const quantity = Math.trunc(Number(raw?.quantity))
      const unit_price = Number(raw?.unit_price)
      if (!title || !Number.isFinite(quantity) || quantity < 1) return null
      if (!Number.isFinite(unit_price) || unit_price <= 0) return null
      return { title, quantity, unit_price, currency_id: 'COP' }
    })
    .filter((i): i is MpPreferenceItem => i !== null)

  if (!items.length) {
    throw createError({ statusCode: 422, message: 'Carrito vacío o inválido' })
  }

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
