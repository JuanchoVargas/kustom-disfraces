/**
 * Inicia el pago con Mercado Pago (Checkout Pro) desde el carrito.
 * Pide al servidor una preferencia con los ítems del carrito y redirige al
 * comprador a la pantalla de pago de MP (sandbox en Fase 1 / PRUEBA).
 *
 * Cada componente que lo llame obtiene su propio estado (loading/error): no es
 * un store global. Convive con el flujo de WhatsApp — es un CTA adicional.
 *
 * PRECIOS: el servidor decide el precio al pagar (pricing.ts, con la promoción
 * por fecha vigente). `cotizar()` pide un dry_run sin unit_price, actualiza el
 * carrito con los precios del servidor y devuelve el total; `pay()` manda como
 * unit_price esos mismos precios, así el cliente paga exactamente lo que vio. Si
 * aun así el servidor responde 422 price_mismatch (la promoción empezó o terminó
 * entre la cotización y el clic, o un precio cambió en Woo), se recotiza en la misma
 * pantalla y se avisa; el nombre de la promoción sale del servidor, nunca del código.
 */
export interface LineaCotizada {
  sku: string
  size?: string
  quantity: number
  unit_price: number
  precio_pleno: number
  promo_id: string | null
  promo_nombre: string | null
}
export interface Cotizacion {
  total: number
  lineas: LineaCotizada[]
  /** Cambios de precio respecto a lo que tenía el carrito. */
  cambios: { sku: string, antes: number, despues: number }[]
}

export function useMercadoPago() {
  const cart = useCartStore()
  const loading = ref(false)
  const error = ref('')
  /** Aviso de cambio de precio (la promoción empezó o terminó). */
  const aviso = ref('')

  const itemsBase = () => cart.items.map(i => ({ sku: i.sku, quantity: i.quantity, size: i.size, gama: i.gama }))

  /** Última cotización del servidor: sirve para saber qué líneas TENÍAN promoción. */
  let ultima: LineaCotizada[] = []

  /**
   * Texto del aviso. Solo nombra la promoción si alguna línea que cambió de precio
   * entró o salió de una (el nombre viene del servidor, es decir de
   * app/data/promociones.json). Cualquier otro cambio de precio (p. ej. un ajuste en
   * Woo) da el aviso genérico.
   */
  function avisoDe(cambios: Cotizacion['cambios'], lineas: LineaCotizada[], anteriores: LineaCotizada[]): string {
    if (!cambios.length) return ''
    const GENERICO = 'Los precios cambiaron. Revisa el total y confirma de nuevo.'
    for (const c of cambios) {
      const ahora = lineas.find(l => l.sku === c.sku)
      const antes = anteriores.find(l => l.sku === c.sku)
      if (ahora?.promo_id && !antes?.promo_id && c.despues < c.antes) return `Los precios cambiaron: el ${ahora.promo_nombre ?? 'descuento'} empezó. Revisa el total y confirma de nuevo.`
      if (!ahora?.promo_id && antes?.promo_id && c.despues > c.antes) return `Los precios cambiaron: el ${antes.promo_nombre ?? 'descuento'} terminó. Revisa el total y confirma de nuevo.`
    }
    return GENERICO
  }

  /**
   * dry_run sin unit_price: el servidor devuelve los precios vigentes por línea.
   * Actualiza el carrito y deja el aviso si algo cambió. Nunca lanza.
   */
  async function cotizar(buyer?: CheckoutBuyer): Promise<Cotizacion | null> {
    if (!cart.items.length) return null
    try {
      const res = await $fetch<{ total: number, lineas: LineaCotizada[] }>('/api/checkout/mercadopago', {
        method: 'POST',
        body: { items: itemsBase(), buyer, dry_run: true },
      })
      const porSku = new Map(res.lineas.map(l => [l.sku, l.unit_price]))
      const cambios = cart.refrescarPrecios(sku => porSku.get(sku))
      aviso.value = avisoDe(cambios, res.lineas, ultima)
      ultima = res.lineas
      return { total: res.total, lineas: res.lineas, cambios }
    }
    catch (err: unknown) {
      const code = (err as { data?: { code?: string } })?.data?.code
      // Sin datos de comprador el dry_run igual cotiza; otros 4xx (sin stock, SKU
      // no vendible) se muestran como en el pago.
      if (code === 'sin_stock' || code === 'sku_not_found') error.value = mensajeDe(err)
      return null
    }
  }

  function mensajeDe(err: unknown): string {
    const data = (err as { data?: { code?: string, items?: { sku: string, size: string, pedido: number, disponible: number }[] } })?.data
    const code = data?.code
    if (code === 'sin_stock') {
      const detalle = (data?.items ?? []).map((it) => {
        const item = cart.items.find(c => c.sku === it.sku)
        const nombre = item?.name ?? it.sku
        return it.disponible > 0 ? `${nombre} talla ${it.size}: quedan ${it.disponible}` : `${nombre} talla ${it.size}: agotada`
      }).join(' · ')
      return `Algunas tallas ya no tienen existencias (${detalle}). Ajusta las cantidades del carrito.`
    }
    if (code === 'promo_override') return 'Este entorno de pruebas no acepta pagos reales.'
    if (code === 'sku_not_found') return 'Un producto del carrito ya no está disponible. Revisa el carrito.'
    return 'No se pudo iniciar el pago. Intenta de nuevo o finaliza por WhatsApp.'
  }

  // Se recibe el comprador (datos de /checkout) para pasarlos a la orden vía la
  // preferencia. El flujo va: carrito -> /checkout (formulario) -> pay(buyer) -> MP.
  async function pay(buyer?: CheckoutBuyer) {
    if (!cart.items.length || loading.value) return
    loading.value = true
    error.value = ''
    aviso.value = ''

    // Se envía SKU + cantidad + el unit_price que el cliente VIO (el del carrito,
    // ya cotizado por el servidor). El servidor recalcula por SKU y, si no coincide,
    // rechaza con 422 price_mismatch: garantiza que el cliente paga lo que vio.
    const items = cart.items.map(i => ({ sku: i.sku, quantity: i.quantity, unit_price: i.price, size: i.size, gama: i.gama }))

    try {
      const res = await $fetch<{ checkout_url?: string, init_point?: string, sandbox_init_point?: string }>(
        '/api/checkout/mercadopago',
        { method: 'POST', body: { items, buyer } },
      )
      // El servidor ya eligió la URL correcta según el token (prod vs sandbox).
      const url = res.checkout_url || res.init_point || res.sandbox_init_point
      if (!url) throw new Error('sin_init_point')
      window.location.href = url
    }
    catch (err: unknown) {
      const code = (err as { data?: { code?: string } })?.data?.code
      if (code === 'price_mismatch') {
        // La promoción empezó o terminó desde que se cotizó: se actualizan precios y
        // totales EN LA MISMA PANTALLA (sin recargar) y el cliente confirma de nuevo.
        const c = await cotizar(buyer)
        if (!aviso.value) aviso.value = 'Los precios cambiaron. Revisa el total y confirma de nuevo.'
        if (!c) error.value = 'Los precios cambiaron. Revisa el total y confirma de nuevo.'
      }
      else {
        error.value = mensajeDe(err)
      }
      console.error('[mercadopago] no se pudo iniciar el pago:', (err as Error)?.message ?? err)
      loading.value = false // en éxito no se resetea: la página está redirigiendo
    }
  }

  return { pay, cotizar, loading, error, aviso }
}
