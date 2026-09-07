import { ImgError, getProductImages } from '../../../../utils/inventoryImages'
import { wpMediaPing } from '../../../../utils/wpMedia'

/** Imagen principal + galería + imagen por talla de un producto, y si se pueden editar (bloqueo). */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const sku = decodeURIComponent(String(getRouterParam(event, 'sku') ?? '')).trim()
  try {
    const { product, bloqueo } = await getProductImages(sku)
    const wp = bloqueo ? null : await wpMediaPing()
    return {
      sku: product.sku,
      status: product.status,
      images: product.images,
      variaciones: product.variations.map(v => ({ sku: v.sku, id: v.id, talla: v.attributes.find(a => a.name === 'Talla')?.option ?? '', image: v.image ?? null })),
      bloqueo: bloqueo ?? (wp && !wp.ok ? wp.detail : null),
    }
  }
  catch (err) {
    if (err instanceof ImgError) throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
