import type { CartItem } from '~~/shared/types/woo'

/**
 * Store del carrito (Pinia). Estado solo en cliente por ahora.
 * defineStore lo auto-importa @pinia/nuxt.
 */
/**
 * @deprecated NO USADO. La política de envío ya no depende de un umbral en COP:
 * el envío es gratis a todo el país (mensaje fijo en el carrito). Se conserva
 * solo por si vuelve a aplicar un umbral.
 */
export const FREE_SHIPPING_THRESHOLD = 200_000

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([])

  const count = computed(() => items.value.reduce((n, i) => n + i.quantity, 0))
  const subtotal = computed(() => items.value.reduce((s, i) => s + i.price * i.quantity, 0))

  // ---- drawer lateral ----
  const drawerOpen = ref(false)
  function openDrawer() { drawerOpen.value = true }
  function closeDrawer() { drawerOpen.value = false }

  // Misma variante (producto + talla + gama) se agrupa.
  const keyOf = (i: CartItem) => `${i.productId}|${i.size}|${i.gama ?? ''}`

  function add(item: CartItem) {
    const existing = items.value.find(i => keyOf(i) === keyOf(item))
    if (existing) existing.quantity += item.quantity
    else items.value.push({ ...item })
  }
  function remove(index: number) {
    items.value.splice(index, 1)
  }
  function setQty(index: number, qty: number) {
    if (qty <= 0) remove(index)
    else if (items.value[index]) items.value[index].quantity = qty
  }
  function clear() {
    items.value = []
  }

  /**
   * Refresca el precio de cada ítem por SKU contra el catálogo ACTUAL (con la
   * promoción por fecha ya aplicada por el servidor). El precio de una línea del
   * carrito es el que el cliente vio al añadirla; si una promoción empieza o
   * termina con el carrito armado, esta función lo actualiza sin perder líneas.
   * Devuelve los cambios para poder avisar ("los precios cambiaron").
   */
  function refrescarPrecios(precioDe: (sku: string) => number | undefined): { sku: string, antes: number, despues: number }[] {
    const cambios: { sku: string, antes: number, despues: number }[] = []
    for (const it of items.value) {
      if (!it.sku) continue
      const nuevo = precioDe(it.sku)
      if (typeof nuevo !== 'number' || !(nuevo > 0) || nuevo === it.price) continue
      cambios.push({ sku: it.sku, antes: it.price, despues: nuevo })
      it.price = nuevo
    }
    return cambios
  }

  return { items, count, subtotal, add, remove, setQty, clear, refrescarPrecios, drawerOpen, openDrawer, closeDrawer }
})
