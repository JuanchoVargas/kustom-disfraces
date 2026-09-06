import { importPreview } from '../../utils/inventoryBulk'
import { readSpreadsheet } from '../../utils/xlsxLite'

/**
 * IMPORTAR (vista previa, no escribe): multipart con `file` (.xlsx o .csv).
 * Valida fila por fila (SKU inexistente, precio inválido, oferta ≥ precio,
 * stock negativo, repetidos) y devuelve antes → después + las operaciones a
 * confirmar en /api/inventario/operaciones (origen 'importacion').
 */
const MAX_BYTES = 5 * 1024 * 1024

export default defineEventHandler(async (event) => {
  requireInbox(event)
  const parts = await readMultipartFormData(event).catch(() => null)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) throw createError({ statusCode: 400, statusMessage: 'archivo_requerido' })
  if (file.data.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'archivo_muy_grande' })
  let sheet
  try { sheet = readSpreadsheet(Buffer.from(file.data), file.filename ?? '') }
  catch (err) { throw createError({ statusCode: 422, statusMessage: `archivo_ilegible: ${String((err as Error)?.message ?? err)}` }) }
  if (sheet.length < 2) throw createError({ statusCode: 422, statusMessage: 'archivo_sin_filas' })

  const store = getInventoryStore()
  const first = await store.listProducts({ page: 1, per_page: 100 })
  const products = [...first.items]
  for (let page = 2; page <= first.total_pages; page++) products.push(...(await store.listProducts({ page, per_page: 100 })).items)
  const result = importPreview(products, sheet)
  return { archivo: file.filename ?? 'archivo', simulation: store.simulation, ...result }
})
