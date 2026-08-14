/**
 * Inicia el pago con Mercado Pago (Checkout Pro) desde el carrito.
 * Pide al servidor una preferencia con los ítems del carrito y redirige al
 * comprador a la pantalla de pago de MP (sandbox en Fase 1 / PRUEBA).
 *
 * Cada componente que lo llame obtiene su propio estado (loading/error): no es
 * un store global. Convive con el flujo de WhatsApp — es un CTA adicional.
 */
export function useMercadoPago() {
  const cart = useCartStore()
  const loading = ref(false)
  const error = ref('')

  async function pay() {
    if (!cart.items.length || loading.value) return
    loading.value = true
    error.value = ''

    // Se envía SKU + cantidad (lo esencial). El precio real, el nombre y la foto los
    // pone el SERVIDOR por SKU (seguridad): unit_price aquí solo sirve para que el
    // servidor detecte manipulación. size/gama son para el título (display).
    const items = cart.items.map(i => ({
      sku: i.sku,
      quantity: i.quantity,
      unit_price: i.price,
      size: i.size,
      gama: i.gama,
    }))

    try {
      const res = await $fetch<{ checkout_url?: string, init_point?: string, sandbox_init_point?: string }>(
        '/api/checkout/mercadopago',
        { method: 'POST', body: { items } },
      )
      // El servidor ya eligió la URL correcta según el token (prod vs sandbox).
      const url = res.checkout_url || res.init_point || res.sandbox_init_point
      if (!url) throw new Error('sin_init_point')
      window.location.href = url
    }
    catch (err: unknown) {
      // El servidor rechaza si detecta precios manipulados o un producto no disponible.
      const code = (err as { data?: { code?: string } })?.data?.code
      error.value = (code === 'price_mismatch' || code === 'sku_not_found')
        ? 'Los precios cambiaron. Recarga la página y vuelve a intentar.'
        : 'No se pudo iniciar el pago. Intenta de nuevo o finaliza por WhatsApp.'
      console.error('[mercadopago] no se pudo iniciar el pago:', err)
      loading.value = false // en éxito no se resetea: la página está redirigiendo
    }
  }

  return { pay, loading, error }
}
