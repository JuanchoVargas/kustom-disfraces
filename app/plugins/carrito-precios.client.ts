/**
 * Al cargar la app en el navegador, el carrito refresca el precio de cada ítem
 * por SKU contra el catálogo actual (que ya trae la promoción por fecha decidida
 * por el servidor). Hoy el carrito vive en memoria y arranca vacío en cada carga,
 * así que esto cubre el día en que persista; el caso vivo (una sesión abierta que
 * cruza el inicio o el fin de una promoción) lo cubre el dry_run del checkout.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', () => {
    const cart = useCartStore()
    if (!cart.items.length) return
    const { products } = useProducts()
    const porSku = new Map(products.map(p => [p.code ?? '', p.price]))
    const cambios = cart.refrescarPrecios(sku => porSku.get(sku))
    if (cambios.length) console.info(`[carrito] ${cambios.length} precio(s) actualizado(s) al cargar`)
  })
})
