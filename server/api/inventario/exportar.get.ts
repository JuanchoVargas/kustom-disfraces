import type { InvListFilters } from '~~/shared/types/inventory'
import { EXPORT_HEADER, EXPORT_WIDTHS, exportRows } from '../../utils/inventoryBulk'
import { writeCsv, writeXlsx } from '../../utils/xlsxLite'

/**
 * EXPORTAR a Excel (.xlsx, default) o CSV (?formato=csv) una fila por talla con
 * los mismos filtros de la lista (?q, ?status, ?grupo, ?publico, ?stock). El
 * archivo sirve también de PLANTILLA de importación: se editan las columnas
 * "Precio normal", "Precio rebajado" y "Stock" y se sube en "Importar".
 */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  const q = getQuery(event)
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const filters: InvListFilters = {
    q: s(q.q),
    status: (['publish', 'draft', 'any'].includes(s(q.status)) ? s(q.status) : 'any') as InvListFilters['status'],
    grupo: s(q.grupo) || undefined,
    publico: s(q.publico) || undefined,
    stock: (['bajo', 'agotado', 'sin_gestion'].includes(s(q.stock)) ? s(q.stock) : 'any') as InvListFilters['stock'],
    orderby: 'sku', order: 'asc', page: 1, per_page: 100,
  }
  const store = getInventoryStore()
  const first = await store.listProducts(filters)
  const products = [...first.items]
  for (let page = 2; page <= first.total_pages; page++) products.push(...(await store.listProducts({ ...filters, page })).items)
  const rows = exportRows(products)
  const stamp = new Date().toISOString().slice(0, 10)
  if (s(q.formato) === 'csv') {
    setHeader(event, 'content-type', 'text/csv; charset=utf-8')
    setHeader(event, 'content-disposition', `attachment; filename="inventario-kustom-${stamp}.csv"`)
    return writeCsv(EXPORT_HEADER, rows)
  }
  setHeader(event, 'content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  setHeader(event, 'content-disposition', `attachment; filename="inventario-kustom-${stamp}.xlsx"`)
  return writeXlsx('Inventario', EXPORT_HEADER, rows, EXPORT_WIDTHS)
})
