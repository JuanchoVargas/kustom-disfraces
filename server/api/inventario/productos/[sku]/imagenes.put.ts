import { ImgError, reorderProductImages, removeProductImage, setVariationImage } from '../../../../utils/inventoryImages'

/**
 * Cambios sobre las imágenes de un producto (JSON):
 *   { accion: 'orden', ids: [..] }                      → reordenar; ids[0] = principal
 *   { accion: 'principal', id }                         → esa imagen pasa a principal
 *   { accion: 'quitar', id }                            → quita la asociación (no borra el archivo)
 *   { accion: 'talla', sku_talla, id | null }           → imagen propia de una talla (null = hereda)
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const sku = decodeURIComponent(String(getRouterParam(event, 'sku') ?? '')).trim()
  const body = await readBody<any>(event).catch(() => ({}))
  const autor = typeof body?.autor === 'string' ? body.autor.trim().slice(0, 60) : undefined
  try {
    let product
    if (body?.accion === 'orden') product = await reorderProductImages(sku, (body.ids ?? []).map(Number), autor)
    else if (body?.accion === 'principal') {
      const { product: p } = await import('../../../../utils/inventoryImages').then(m => m.getProductImages(sku))
      const id = Number(body.id)
      product = await reorderProductImages(sku, [id, ...p.images.map(i => i.id).filter(i => i !== id)], autor)
    }
    else if (body?.accion === 'quitar') product = await removeProductImage(sku, Number(body.id), autor)
    else if (body?.accion === 'talla') product = await setVariationImage(String(body.sku_talla ?? ''), body.id === null ? null : Number(body.id), autor)
    else throw createError({ statusCode: 400, statusMessage: 'accion_desconocida' })
    return { ok: true, images: product.images, variaciones: product.variations.map(v => ({ sku: v.sku, image: v.image ?? null })) }
  }
  catch (err) {
    if (err instanceof ImgError) throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
