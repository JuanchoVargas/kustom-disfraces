import type { InvImage, InvProduct } from '~~/shared/types/inventory'
import { dbConfigured, ensureSchema, sql } from './db'
import { loadProductBySku, snapshotUpsert } from './inventorySnapshot'
import { recomputeProduct } from './inventoryCommon'
import { sanitizeWooWriteError, wooWriteConfigured, wooWriteFetch } from './wooWrite'
import { mediaFilename, processImage, uploadMedia, wpMediaConfigured } from './wpMedia'

/**
 * IMÁGENES DE PRODUCTO desde el panel (Fase A). Operaciones:
 *   upload   → procesa (≤1600 px, WebP 85, nombre = SKU), sube a wp/v2/media y
 *              la añade al final de la galería del producto (o como principal si no hay).
 *   order    → nueva lista ordenada de ids: la primera es la principal.
 *   remove   → quita la ASOCIACIÓN (el archivo sigue en la biblioteca de WordPress).
 *   variation→ imagen propia de una talla (Woo: variations/<id>.image); null = hereda.
 *
* DESACOPLADO del adaptador de inventario: funciona con NUXT_INVENTORY_BACKEND en
 * mock o woo. Las imágenes van directo a WordPress/Woo y, mientras la Fase B siga
 * apagada (NUXT_PUBLIC_IMAGES_SOURCE=local), la web sigue mostrando las fotos
 * locales: subir NO afecta al sitio público. Guarda propia:
 * NUXT_IMAGES_ONLY_DRAFTS, default true = solo borradores; 'false' explícito abre publicados.
 * Cada cambio deja fila en inventory_changes (campo image_*). Escritura primero
 * a Woo; el snapshot se actualiza solo si Woo aceptó.
 */

export class ImgError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export function imagesOnlyDrafts(): boolean {
  return String(useRuntimeConfig().imagesOnlyDrafts ?? 'true') !== 'false'
}

export function imagesBlockReason(p: InvProduct): string | null {
  if (!wpMediaConfigured()) return 'Faltan las credenciales de WordPress para medios (NUXT_WP_APP_USER / NUXT_WP_APP_PASSWORD).'
  if (!wooWriteConfigured()) return 'Falta la llave de escritura de WooCommerce.'
  if (imagesOnlyDrafts() && p.status === 'publish') return 'Bloqueado: por ahora solo se pueden cambiar imágenes de productos en BORRADOR (NUXT_IMAGES_ONLY_DRAFTS).'
  if (p.id <= 0) return 'El producto aún no tiene id de Woo en el snapshot: pulsa "Sincronizar con Woo".'
  return null
}

async function logImageChange(sku: string, campo: string, anterior: string | null, nuevo: string | null, autor?: string): Promise<void> {
  if (!dbConfigured()) return
  try {
    await ensureSchema()
    await sql().query(
      `INSERT INTO inventory_changes (backend, sku, campo, anterior, nuevo, origen, autor) VALUES ('woo',$1,$2,$3,$4,'panel',$5)`,
      [sku, campo, anterior, nuevo, autor ?? null],
    )
  }
  catch (err) {
    console.error('[inventario-img] no se pudo registrar el cambio:', String((err as Error)?.message ?? err))
  }
}

const imgLabel = (i: InvImage | null | undefined) => (i ? `${i.id}:${i.name ?? i.src.split('/').pop()}` : null)
const listLabel = (imgs: InvImage[]) => imgs.map(i => i.id).join(',') || null

interface WooProductImages { id: number, images: { id: number, src: string, name?: string, alt?: string }[] }

/** Escribe la lista de imágenes del producto en Woo y actualiza el snapshot. */
export async function writeImages(p: InvProduct, images: InvImage[], campo: string, autor?: string): Promise<InvProduct> {
  const before = listLabel(p.images)
  const res = await wooWriteFetch<WooProductImages>(`/products/${p.id}`, { method: 'PUT', body: { images: images.map(i => ({ id: i.id })) } })
  const next: InvProduct = { ...p, images: (res.images ?? []).map(i => ({ id: i.id, src: i.src, name: i.name, alt: i.alt })), fetched_at: new Date().toISOString() }
  await snapshotUpsert([recomputeProduct(next)])
  await logImageChange(p.sku, campo, before, listLabel(next.images), autor)
  return next
}

export async function getProductImages(sku: string): Promise<{ product: InvProduct, bloqueo: string | null }> {
  const p = await loadProductBySku(sku)
  if (!p) throw new ImgError('producto inexistente', 404)
  return { product: p, bloqueo: imagesBlockReason(p) }
}

/** Sube UNA imagen (ya en memoria) y la añade a la galería. Devuelve el producto actualizado. */
export async function uploadProductImage(sku: string, data: Buffer, mime: string, autor?: string): Promise<{ product: InvProduct, image: InvImage, bytes_in: number, bytes_out: number, width: number, height: number }> {
  const p = await loadProductBySku(sku)
  if (!p) throw new ImgError('producto inexistente', 404)
  const bloqueo = imagesBlockReason(p)
  if (bloqueo) throw new ImgError(bloqueo, 409)
  const processed = await processImage(data, mime).catch((err) => { throw new ImgError(String(err.message ?? err), 422) })
  const filename = mediaFilename(p.sku, p.images.length + 1)
  let media
  try {
    media = await uploadMedia(processed.data, filename, { title: `${p.name} (${p.sku})`, alt: p.name })
  }
  catch (err) {
    throw new ImgError(`WordPress rechazó la subida: ${String((err as Error)?.message ?? err)}`, 502)
  }
  const image: InvImage = { id: media.id, src: media.source_url, name: filename, alt: p.name }
  let next: InvProduct
  try {
    next = await writeImages(p, [...p.images, image], 'image_add', autor)
  }
  catch (err) {
    throw new ImgError(`Se subió a la biblioteca (id ${media.id}) pero Woo no la asoció al producto: ${sanitizeWooWriteError(err)}`, 502)
  }
  return { product: next, image, bytes_in: data.length, bytes_out: processed.bytes, width: processed.width, height: processed.height }
}

/** Reordena la galería; ids[0] pasa a ser la principal. */
export async function reorderProductImages(sku: string, ids: number[], autor?: string): Promise<InvProduct> {
  const p = await loadProductBySku(sku)
  if (!p) throw new ImgError('producto inexistente', 404)
  const bloqueo = imagesBlockReason(p)
  if (bloqueo) throw new ImgError(bloqueo, 409)
  const byId = new Map(p.images.map(i => [i.id, i]))
  const ordered = ids.map(id => byId.get(id)).filter((i): i is InvImage => !!i)
  if (ordered.length !== p.images.length || new Set(ids).size !== ids.length) throw new ImgError('la lista de ids no coincide con las imágenes del producto', 400)
  if (ordered.map(i => i.id).join(',') === p.images.map(i => i.id).join(',')) return p
  const campo = ordered[0]?.id !== p.images[0]?.id ? 'image_main' : 'image_order'
  try { return await writeImages(p, ordered, campo, autor) }
  catch (err) { throw new ImgError(`Woo no aceptó el nuevo orden: ${sanitizeWooWriteError(err)}`, 502) }
}

/** Quita una imagen del producto (la asociación); el archivo sigue en WordPress. */
export async function removeProductImage(sku: string, id: number, autor?: string): Promise<InvProduct> {
  const p = await loadProductBySku(sku)
  if (!p) throw new ImgError('producto inexistente', 404)
  const bloqueo = imagesBlockReason(p)
  if (bloqueo) throw new ImgError(bloqueo, 409)
  const img = p.images.find(i => i.id === id)
  if (!img) throw new ImgError('esa imagen no está en el producto', 404)
  const rest = p.images.filter(i => i.id !== id)
  try {
    const next = await writeImages(p, rest, 'image_remove', autor)
    await logImageChange(p.sku, 'image_remove_detalle', imgLabel(img), null, autor)
    return next
  }
  catch (err) { throw new ImgError(`Woo no aceptó quitar la imagen: ${sanitizeWooWriteError(err)}`, 502) }
}

/** Imagen propia de una talla: id de una imagen del producto, o null para heredar la principal. */
export async function setVariationImage(skuTalla: string, imageId: number | null, autor?: string): Promise<InvProduct> {
  const p = await loadProductBySku(skuTalla)
  if (!p) throw new ImgError('producto inexistente', 404)
  const bloqueo = imagesBlockReason(p)
  if (bloqueo) throw new ImgError(bloqueo, 409)
  const v = p.variations.find(x => x.sku === skuTalla)
  if (!v || v.id <= 0) throw new ImgError('talla inexistente o sin id de Woo', 404)
  const img = imageId === null ? null : p.images.find(i => i.id === imageId)
  if (imageId !== null && !img) throw new ImgError('la imagen debe ser una de las del producto', 400)
  try {
    // Woo: image: { id } asigna; image: null quita (hereda la principal del padre).
    const res = await wooWriteFetch<{ image?: { id: number, src: string, name?: string, alt?: string } | null }>(`/products/${p.id}/variations/${v.id}`, { method: 'PUT', body: { image: img ? { id: img.id } : null } })
    const nextV = { ...v, image: res.image?.id ? { id: res.image.id, src: res.image.src, name: res.image.name, alt: res.image.alt } : null }
    const next: InvProduct = { ...p, variations: p.variations.map(x => (x.sku === skuTalla ? nextV : x)), fetched_at: new Date().toISOString() }
    await snapshotUpsert([recomputeProduct(next)])
    await logImageChange(skuTalla, 'image_variation', imgLabel(v.image), imgLabel(nextV.image), autor)
    return next
  }
  catch (err) { throw new ImgError(`Woo no aceptó la imagen de la talla: ${sanitizeWooWriteError(err)}`, 502) }
}
