import type { CartItem } from '~~/shared/types/woo'

/**
 * Store del carrito (Pinia). Estado solo en cliente por ahora.
 * defineStore lo auto-importa @pinia/nuxt.
 */
/** Umbral de envío gratis en COP — ⚠ PROVISIONAL, confirmar con el cliente */
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

  return { items, count, subtotal, add, remove, setQty, clear, drawerOpen, openDrawer, closeDrawer }
})
