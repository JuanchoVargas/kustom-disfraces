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

    // Título legible por ítem (nombre + talla + gama); el precio unitario y la
    // cantidad definen el monto total que muestra Mercado Pago. El `slug` permite
    // que el servidor arme el picture_url público (foto en "Detalles del pago").
    const items = cart.items.map(i => ({
      title: `${i.name} (Talla ${i.size}${i.gama ? `, ${i.gama}` : ''})`,
      quantity: i.quantity,
      unit_price: i.price,
      slug: i.slug,
      sku: i.sku,
    }))

    try {
      const res = await $fetch<{ init_point?: string, sandbox_init_point?: string }>(
        '/api/checkout/mercadopago',
        { method: 'POST', body: { items } },
      )
      // Fase 1: preferimos sandbox_init_point (entorno de prueba).
      const url = res.sandbox_init_point || res.init_point
      if (!url) throw new Error('sin_init_point')
      window.location.href = url
    }
    catch (err) {
      error.value = 'No se pudo iniciar el pago. Intenta de nuevo o finaliza por WhatsApp.'
      console.error('[mercadopago] no se pudo iniciar el pago:', err)
      loading.value = false // en éxito no se resetea: la página está redirigiendo
    }
  }

  return { pay, loading, error }
}
