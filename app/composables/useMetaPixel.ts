/**
 * META PIXEL (fase 1, navegador). Única puerta para disparar eventos.
 *
 * - NUXT_PUBLIC_META_PIXEL_ID vacío = pixel APAGADO: no se carga fbevents.js, no
 *   existe window.fbq y estas funciones no hacen nada (cero peticiones a Meta).
 * - Nunca en /admin/*: ni carga, ni PageView, ni eventos.
 * - SIN advanced matching: jamás se envía correo, teléfono, nombre ni dirección.
 *   Los eventos solo llevan códigos de referencia, cantidades y montos en COP.
 * - No escribe nada en la consola.
 *
 * La carga e init viven en app/plugins/meta-pixel.client.ts.
 */
type FbqParams = Record<string, unknown>

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void, queue?: unknown[], loaded?: boolean, version?: string, push?: unknown, disablePushState?: boolean }
    _fbq?: unknown
  }
}

/** Datos mínimos de una línea para los eventos de comercio. */
export interface PixelLinea { code?: string, price: number, quantity?: number }

/** Compra guardada al iniciar el pago, para el Purchase de /pago-exitoso. */
export interface CompraPendiente { total: number, num_items: number, lineas: { id: string, quantity: number, item_price: number }[], ts: number }

const CLAVE_COMPRA = 'kustom_pixel_compra'
const CLAVE_ENVIADAS = 'kustom_pixel_purchase_enviado'

export const esRutaAdmin = (path: string) => path === '/admin' || path.startsWith('/admin/')

export function useMetaPixel() {
  const id = String(useRuntimeConfig().public.metaPixelId || '').trim()
  const route = useRoute()
  const activo = () => import.meta.client && !!id && !esRutaAdmin(route.path) && typeof window.fbq === 'function'

  function track(evento: string, params: FbqParams = {}, eventID?: string) {
    if (!activo()) return
    if (eventID) window.fbq!('track', evento, params, { eventID })
    else window.fbq!('track', evento, params)
  }

  /** Parámetros estándar de comercio: COP, content_type product, content_ids = código de referencia. */
  function comercio(lineas: PixelLinea[], value?: number): FbqParams {
    const validas = lineas.filter(l => l.code)
    const total = value ?? validas.reduce((n, l) => n + l.price * (l.quantity ?? 1), 0)
    return {
      content_type: 'product',
      content_ids: [...new Set(validas.map(l => l.code as string))],
      contents: validas.map(l => ({ id: l.code, quantity: l.quantity ?? 1, item_price: l.price })),
      currency: 'COP',
      value: total,
    }
  }

  /** PDP: precio EFECTIVO (con promoción por fecha si aplica). */
  const viewContent = (p: { code?: string, price: number, name?: string }) =>
    track('ViewContent', { ...comercio([{ code: p.code, price: p.price }]), content_name: p.name })

  const addToCart = (l: PixelLinea & { name?: string }) =>
    track('AddToCart', { ...comercio([l]), content_name: l.name })

  /** value y num_items salen del total que calculó el SERVIDOR (cotización). */
  const initiateCheckout = (lineas: PixelLinea[], totalServidor: number) =>
    track('InitiateCheckout', { ...comercio(lineas, totalServidor), num_items: lineas.reduce((n, l) => n + (l.quantity ?? 1), 0) })

  /** Al iniciar el pago: guarda lo que se va a cobrar (sessionStorage) para el Purchase. */
  function guardarCompra(lineas: PixelLinea[], total: number) {
    if (!import.meta.client || !id) return
    const compra: CompraPendiente = {
      total,
      num_items: lineas.reduce((n, l) => n + (l.quantity ?? 1), 0),
      lineas: lineas.filter(l => l.code).map(l => ({ id: l.code as string, quantity: l.quantity ?? 1, item_price: l.price })),
      ts: Date.now(),
    }
    try { sessionStorage.setItem(CLAVE_COMPRA, JSON.stringify(compra)) }
    catch { /* sessionStorage bloqueado: no habrá Purchase de navegador (lo cubrirá la Conversions API) */ }
  }

  /**
   * /pago-exitoso: Purchase SOLO si MP devolvió status=approved, con eventID =
   * payment_id (para deduplicar con la Conversions API) y value = total guardado al
   * iniciar el pago. Protegido contra doble disparo al recargar: el payment_id queda
   * anotado y la compra guardada se borra.
   */
  function purchaseSiAprobado(query: Record<string, unknown>): boolean {
    if (!activo()) return false
    const status = String(query.status ?? query.collection_status ?? '')
    const paymentId = String(query.payment_id ?? query.collection_id ?? '').trim()
    if (status !== 'approved' || !paymentId || paymentId === 'null') return false
    try {
      const enviadas: string[] = JSON.parse(sessionStorage.getItem(CLAVE_ENVIADAS) || '[]')
      if (enviadas.includes(paymentId)) return false
      const raw = sessionStorage.getItem(CLAVE_COMPRA)
      if (!raw) return false
      const compra = JSON.parse(raw) as CompraPendiente
      if (!(compra?.total > 0)) return false
      track('Purchase', {
        content_type: 'product',
        content_ids: [...new Set(compra.lineas.map(l => l.id))],
        contents: compra.lineas,
        num_items: compra.num_items,
        currency: 'COP',
        value: compra.total,
      }, paymentId)
      sessionStorage.setItem(CLAVE_ENVIADAS, JSON.stringify([...enviadas, paymentId].slice(-20)))
      sessionStorage.removeItem(CLAVE_COMPRA)
      return true
    }
    catch {
      return false
    }
  }

  return { habilitado: !!id, track, viewContent, addToCart, initiateCheckout, guardarCompra, purchaseSiAprobado }
}
