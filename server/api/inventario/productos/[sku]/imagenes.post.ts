import { ImgError, uploadProductImage } from '../../../../utils/inventoryImages'
import { MAX_UPLOAD_BYTES } from '../../../../utils/wpMedia'

/**
 * Subir UNA imagen (multipart `file`) al producto: se procesa (≤1600 px, WebP 85,
 * nombre = SKU) y se añade a la galería (principal si no había). Una llamada por
 * archivo: el panel muestra progreso y error por archivo, no global.
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const sku = decodeURIComponent(String(getRouterParam(event, 'sku') ?? '')).trim()
  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'archivo_requerido' })
  if (file.data.length > MAX_UPLOAD_BYTES) throw createError({ statusCode: 413, statusMessage: `El archivo pesa ${(file.data.length / 1048576).toFixed(1)} MB; el máximo es 10 MB` })
  const autor = String(parts?.find(p => p.name === 'autor')?.data?.toString('utf8') ?? '').trim().slice(0, 60) || undefined
  try {
    const r = await uploadProductImage(sku, Buffer.from(file.data), String(file.type ?? ''), autor)
    return { ok: true, image: r.image, images: r.product.images, procesado: { entrada_kb: Math.round(r.bytes_in / 1024), salida_kb: Math.round(r.bytes_out / 1024), ancho: r.width, alto: r.height } }
  }
  catch (err) {
    if (err instanceof ImgError) throw createError({ statusCode: err.status, statusMessage: err.message })
    throw err
  }
})
