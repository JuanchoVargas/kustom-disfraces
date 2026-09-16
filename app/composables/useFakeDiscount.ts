/**
 * Precio tachado (gancho de oferta), controlado por flag de configuración.
 * SOLO visual: no toca `product.price` (el que se cobra y se valida en el
 * servidor vía pricing.ts) ni `product.regularPrice` (descuento real, si
 * algún día lo hay). ENCENDIDO por defecto (nuxt.config: `showDiscount` es true
 * salvo NUXT_PUBLIC_SHOW_DISCOUNT=false); se apaga sin deploy poniendo esa env
 * var en false en Vercel (obligatorio el día que haya sale_price real, si no el
 * descuento se duplica; ver docs/inventario-activacion.md B6).
 */
export function useFakeDiscount() {
  const config = useRuntimeConfig().public
  const enabled = computed(() => !!config.showDiscount)
  const pct = computed(() => Number(config.fakeDiscountPct) || 20)

  // Precio "anterior" inventado: precio real × (1 + pct%), redondeado a cien
  // (coincide con la columna PRECIO TACHADO de PRECIOS WEB.xlsx, ago 2026).
  function strikeFor(price: number): number | null {
    if (!enabled.value || !price) return null
    return Math.round((price * (1 + pct.value / 100)) / 100) * 100
  }

  return { enabled, pct, strikeFor }
}
