import type { InvListFilters } from '~~/shared/types/inventory'

/**
 * Lista paginada de productos (shape Woo + variaciones + kustom).
 *   ?q= texto (nombre o SKU)  ?status=publish|draft|any  ?grupo=  ?publico=
 *   ?stock=any|bajo|agotado|sin_gestion  ?orderby=name|sku|price|stock|modified
 *   ?order=asc|desc  ?page=  ?per_page= (máx 100)
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const q = getQuery(event)
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const filters: InvListFilters = {
    q: s(q.q),
    status: (['publish', 'draft', 'pending', 'private', 'any'].includes(s(q.status)) ? s(q.status) : 'any') as InvListFilters['status'],
    grupo: s(q.grupo) || undefined,
    publico: s(q.publico) || undefined,
    stock: (['bajo', 'agotado', 'sin_gestion'].includes(s(q.stock)) ? s(q.stock) : 'any') as InvListFilters['stock'],
    orderby: (['name', 'sku', 'price', 'stock', 'modified'].includes(s(q.orderby)) ? s(q.orderby) : 'sku') as InvListFilters['orderby'],
    order: s(q.order) === 'desc' ? 'desc' : 'asc',
    page: Number(q.page) || 1,
    per_page: Number(q.per_page) || 25,
  }
  const page = await getInventoryStore().listProducts(filters)
  return { ...page, filters, backend: getInventoryStore().backend, simulation: getInventoryStore().simulation }
})
