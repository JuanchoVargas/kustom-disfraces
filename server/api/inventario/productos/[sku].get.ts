import { listChanges } from '../../../utils/inventoryCommon'

/** Un producto por SKU de padre o de variación, con sus últimos cambios. */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const sku = decodeURIComponent(String(getRouterParam(event, 'sku') ?? '')).trim()
  if (!sku) throw createError({ statusCode: 400, statusMessage: 'sku_requerido' })
  const product = await getInventoryStore().getProduct(sku)
  if (!product) throw createError({ statusCode: 404, statusMessage: 'sku_inexistente' })
  const cambios = await listChanges({ sku: product.sku, per_page: 30 })
  return { product, cambios: cambios.items }
})
