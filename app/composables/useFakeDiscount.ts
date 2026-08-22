/**
 * Precio tachado (gancho de oferta), controlado por flag de configuración.
 * SOLO visual: no toca `product.price` (el que se cobra y se valida en el
 * servidor vía pricing.ts) ni `product.regularPrice` (descuento real, si
 * algún día lo hay). Apagado por defecto (NUXT_PUBLIC_SHOW_DISCOUNT=false);
 * se activa/desactiva sin deploy cambiando la env var en Vercel.
 */
export function useFakeDiscount() {
  const config = useRuntimeConfig().public
  const enabled = computed(() => !!config.showDiscount)
  const pct = computed(() => Number(config.fakeDiscountPct) || 30)

  // Precio "anterior" inventado: precio real × (1 + pct%), redondeado a mil.
  function strikeFor(price: number): number | null {
    if (!enabled.value || !price) return null
    return Math.round((price * (1 + pct.value / 100)) / 1000) * 1000
  }

  return { enabled, pct, strikeFor }
}
