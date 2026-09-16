// INFORME DE COBERTURA DEL INVENTARIO — SOLO LECTURA, no escribe en Woo ni en la BD.
//
//   node scripts/informe-cobertura.mjs
//
// Responde "qué se escribiría si aplicáramos hoy las sobreescrituras a Woo":
// combina el snapshot de Woo (valores REALES de la tienda) con inventory_overrides
// (lo que cargó el equipo en modo práctica) usando EXACTAMENTE la misma fusión que
// el adaptador mock (applyOverride + stockStatusFor), y clasifica el resultado.
//
// Genera en backups/ (carpeta ignorada por git) un Excel por hoja:
//   cobertura-detalle-<fecha>.xlsx    una fila por SKU único de talla: antes → después
//   cobertura-agotados-<fecha>.xlsx   productos PUBLICADOS que quedarían 100 % agotados
//   cobertura-parciales-<fecha>.xlsx  productos con agotado parcial y qué tallas
//   cobertura-resumen-<fecha>.xlsx    los contadores del informe
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const root = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const { writeXlsx } = await jiti.import('../server/utils/xlsxLite.ts')

const sql = neon(env.POSTGRES_URL)

// ---------- misma fusión que server/utils/inventoryMock.ts ----------
const stockStatusFor = v => (!v.manage_stock
  ? (v.stock_status === 'outofstock' ? 'outofstock' : 'instock')
  : ((v.stock_quantity ?? 0) > 0 ? 'instock' : 'outofstock'))

function applyOverride(v, o) {
  if (!o) return { ...v }
  const regular = o.regular_price ?? v.regular_price
  const sale = o.sale_price ?? v.sale_price
  const manage = o.manage_stock ?? v.manage_stock
  const qty = manage ? (o.stock_quantity ?? v.stock_quantity ?? 0) : (o.stock_quantity ?? v.stock_quantity)
  const next = { ...v, regular_price: regular, sale_price: sale, manage_stock: manage, stock_quantity: qty }
  next.stock_status = stockStatusFor(next)
  return next
}

const num = s => { const n = Number(String(s ?? '').trim()); return Number.isFinite(n) ? n : 0 }

/**
 * PROCEDENCIA de cada sobreescritura. Hay que poder separar la carga de inventario
 * del equipo de lo que tocamos nosotros probando el módulo, porque lo segundo NO
 * debe escribirse en Woo. Se marcan por SKU conocido y por ventana horaria de
 * pruebas; todo lo demás se asume carga del equipo.
 */
const PRUEBAS = [
  // Producto de prueba creado para una demostración (8 variaciones con el mismo SKU).
  { test: o => o.sku.startsWith('005001001'), etiqueta: 'PRUEBA — producto de demostración (Vaquerito Woody)' },
  // Sesión de DEMOSTRACIÓN del módulo, madrugada del 10/09 (03:24–03:35 UTC). No es
  // la carga de inventario del equipo (esa es la tanda de las 13:00): hay que
  // confirmar una por una si el valor es real o quedó de la demo.
  { test: o => o.ts >= Date.parse('2026-09-10T03:00:00Z') && o.ts <= Date.parse('2026-09-10T04:00:00Z'), etiqueta: 'REVISAR — sesión de demostración del 10/09 de madrugada' },
]
function procedenciaDe(o) {
  const ctx = { sku: o.sku, ts: new Date(o.updated_at).getTime() }
  for (const r of PRUEBAS) if (r.test(ctx)) return r.etiqueta
  return 'carga del equipo'
}
const tallaDe = v => String(v.attributes?.find(a => a.name === 'Talla')?.option ?? v.sku.slice(v.sku.lastIndexOf('-T') + 2) ?? '?')

// ---------- carga ----------
const snap = await sql.query(`SELECT sku, product FROM inventory_snapshot ORDER BY sku`)
const ovRows = await sql.query(`SELECT sku, regular_price, sale_price, manage_stock, stock_quantity, updated_at, updated_by FROM inventory_overrides`)
const ov = new Map(ovRows.map(o => [o.sku, o]))

const productos = snap.map(r => (typeof r.product === 'string' ? JSON.parse(r.product) : r.product))

// Una fila por SKU ÚNICO de variación (el catálogo tiene SKU repetidos; ver informe).
const porSku = new Map()
const repetidos = new Map()
for (const p of productos) {
  for (const v of p.variations) {
    repetidos.set(v.sku, (repetidos.get(v.sku) ?? 0) + 1)
    if (porSku.has(v.sku)) continue
    porSku.set(v.sku, { p, v })
  }
}

const filas = []
for (const [sku, { p, v }] of porSku) {
  const o = ov.get(sku)
  const d = applyOverride(v, o)
  filas.push({
    sku,
    codigo: p.sku,
    producto: p.name,
    estadoPadre: p.status,
    talla: tallaDe(v),
    copias: repetidos.get(sku) ?? 1,
    // antes (Woo real)
    aRegular: num(v.regular_price), aSale: num(v.sale_price), aManage: !!v.manage_stock, aQty: v.stock_quantity,
    // después (lo que se escribiría)
    dRegular: num(d.regular_price), dSale: num(d.sale_price), dManage: !!d.manage_stock, dQty: d.stock_quantity,
    dEstado: d.stock_status,
    tieneOverride: !!o,
    ovPrecio: !!o && (o.regular_price !== null || o.sale_price !== null),
    ovStock: !!o && (o.manage_stock !== null || o.stock_quantity !== null),
    ovAutor: o?.updated_by ?? '',
    ovFecha: o ? new Date(o.updated_at).toISOString().slice(0, 19).replace('T', ' ') : '',
    ovTs: o ? new Date(o.updated_at).getTime() : 0,
    // Procedencia del dato: carga del equipo vs. algo que tocamos probando.
    procedencia: o ? procedenciaDe(o) : '—',
  })
}

// ---------- clasificación ----------
const R = {}
R.skus_unicos = filas.length
R.variaciones_en_snapshot = productos.reduce((n, p) => n + p.variations.length, 0)
R.skus_repetidos = [...repetidos.entries()].filter(([, n]) => n > 1)

R.precio_cargado = filas.filter(f => f.dRegular > 0).length
R.precio_en_cero = filas.filter(f => f.dRegular <= 0).length
R.con_oferta = filas.filter(f => f.dSale > 0).length

R.stock_sin_tocar = filas.filter(f => !f.ovStock).length
R.stock_cargado_mayor_cero = filas.filter(f => f.ovStock && (f.dQty ?? 0) > 0).length
R.stock_cargado_en_cero = filas.filter(f => f.ovStock && (f.dQty ?? 0) <= 0).length

R.pasan_a_manage = filas.filter(f => !f.aManage && f.dManage).length
R.pasan_a_manage_en_cero = filas.filter(f => !f.aManage && f.dManage && (f.dQty ?? 0) <= 0).length
R.ya_tenian_manage = filas.filter(f => f.aManage).length

const pub = filas.filter(f => f.estadoPadre === 'publish')
const bor = filas.filter(f => f.estadoPadre !== 'publish')
R.publicado_tallas = pub.length
R.borrador_tallas = bor.length
R.publicado_precio_cero = pub.filter(f => f.dRegular <= 0).length
R.borrador_precio_cero = bor.filter(f => f.dRegular <= 0).length
R.publicado_manage = pub.filter(f => f.dManage).length
R.publicado_manage_cero = pub.filter(f => f.dManage && (f.dQty ?? 0) <= 0).length

// agotado por producto: agotada = gestiona stock y cantidad ≤ 0 (misma regla que stockState.ts)
const agotadaF = f => (f.dManage && (f.dQty ?? 0) <= 0) || f.dEstado === 'outofstock'
const porProducto = new Map()
for (const f of filas) {
  if (!porProducto.has(f.codigo)) porProducto.set(f.codigo, { codigo: f.codigo, producto: f.producto, estado: f.estadoPadre, tallas: [] })
  porProducto.get(f.codigo).tallas.push(f)
}
const totales = [], parciales = []
for (const p of porProducto.values()) {
  const outs = p.tallas.filter(agotadaF)
  if (!p.tallas.length || !outs.length) continue
  if (outs.length === p.tallas.length) totales.push(p)
  else parciales.push({ ...p, outs })
}
R.agotados_totales_publicados = totales.filter(p => p.estado === 'publish').length
R.agotados_totales_borrador = totales.filter(p => p.estado !== 'publish').length
R.agotados_parciales = parciales.length

// ---------- salida ----------
const fecha = new Date().toISOString().slice(0, 10)
const dir = `${root}backups`
mkdirSync(dir, { recursive: true })
const guardar = (nombre, hoja, header, rows, widths) => {
  const ruta = `${dir}/${nombre}-${fecha}.xlsx`
  writeFileSync(ruta, writeXlsx(hoja, header, rows, widths))
  console.log(`  📄 ${ruta}  (${rows.length} filas)`)
  return ruta
}

const si = b => (b ? 'sí' : 'no')
guardar('cobertura-detalle', 'Detalle por talla',
  ['SKU talla', 'Código', 'Producto', 'Estado padre', 'Talla', 'Copias del SKU',
    'Precio ANTES', 'Oferta ANTES', 'Gestiona ANTES', 'Stock ANTES',
    'Precio DESPUÉS', 'Oferta DESPUÉS', 'Gestiona DESPUÉS', 'Stock DESPUÉS', 'Estado stock',
    '¿Se escribiría?', 'Toca precio', 'Toca stock', 'Cargado por', 'Fecha y hora', 'Procedencia'],
  filas.map(f => [f.sku, f.codigo, f.producto, f.estadoPadre === 'publish' ? 'publicado' : 'borrador', f.talla, f.copias,
    f.aRegular || null, f.aSale || null, si(f.aManage), f.aManage ? (f.aQty ?? 0) : null,
    f.dRegular || null, f.dSale || null, si(f.dManage), f.dManage ? (f.dQty ?? 0) : null, f.dEstado,
    si(f.tieneOverride), si(f.ovPrecio), si(f.ovStock), f.ovAutor, f.ovFecha]),
  [20, 12, 32, 12, 8, 13, 13, 13, 14, 12, 15, 15, 16, 14, 13, 14, 12, 12, 12, 18])

guardar('cobertura-agotados', 'Agotados totales',
  ['Código', 'Producto', 'Estado', 'Tallas', 'Tallas agotadas', '¿Saldría con cinta AGOTADO?'],
  [...totales].sort((a, b) => (a.estado === b.estado ? a.producto.localeCompare(b.producto) : a.estado === 'publish' ? -1 : 1))
    .map(p => [p.codigo, p.producto, p.estado === 'publish' ? 'publicado' : 'borrador', p.tallas.length,
      p.tallas.map(t => t.talla).join(', '), p.estado === 'publish' ? 'sí — visible en la web' : 'no está publicado']),
  [12, 32, 12, 8, 34, 30])

guardar('cobertura-parciales', 'Agotados parciales',
  ['Código', 'Producto', 'Estado', 'Tallas totales', 'Tallas agotadas', 'Cuáles', 'Cuáles quedan'],
  parciales.sort((a, b) => a.producto.localeCompare(b.producto))
    .map(p => [p.codigo, p.producto, p.estado === 'publish' ? 'publicado' : 'borrador', p.tallas.length, p.outs.length,
      p.outs.map(t => t.talla).join(', '), p.tallas.filter(t => !agotadaF(t)).map(t => t.talla).join(', ')]),
  [12, 32, 12, 13, 14, 26, 26])

// Hoja aparte con lo que NO es carga del equipo: es lo que no debe escribirse en Woo.
const prueba = filas.filter(f => f.tieneOverride && f.procedencia !== 'carga del equipo')
guardar('cobertura-pruebas', 'Overrides de prueba',
  ['SKU talla', 'Código', 'Producto', 'Estado padre', 'Talla', 'Precio DESPUÉS', 'Oferta DESPUÉS', 'Stock DESPUÉS', 'Cargado por', 'Fecha y hora', 'Procedencia'],
  prueba.sort((a, b) => a.ovTs - b.ovTs).map(f => [f.sku, f.codigo, f.producto, f.estadoPadre === 'publish' ? 'publicado' : 'borrador', f.talla,
    f.dRegular || null, f.dSale || null, f.dManage ? (f.dQty ?? 0) : null, f.ovAutor, f.ovFecha, f.procedencia]),
  [20, 12, 32, 12, 8, 15, 15, 14, 12, 20, 52])

const resumen = [
  ['SKU únicos de talla en el snapshot', R.skus_unicos],
  ['Variaciones guardadas (incluye SKU repetidos)', R.variaciones_en_snapshot],
  ['SKU de talla repetidos entre variaciones', R.skus_repetidos.length],
  ['', ''],
  ['PRECIO — con precio cargado (> 0)', R.precio_cargado],
  ['PRECIO — en 0 o vacío', R.precio_en_cero],
  ['PRECIO — con oferta cargada', R.con_oferta],
  ['', ''],
  ['STOCK — sin tocar (ninguna sobreescritura de stock)', R.stock_sin_tocar],
  ['STOCK — cargado con cantidad > 0', R.stock_cargado_mayor_cero],
  ['STOCK — cargado en 0', R.stock_cargado_en_cero],
  ['', ''],
  ['GESTIÓN — tallas que pasarían a manage_stock = true', R.pasan_a_manage],
  ['GESTIÓN — de esas, cuántas quedarían en 0', R.pasan_a_manage_en_cero],
  ['GESTIÓN — tallas que ya gestionaban stock en Woo', R.ya_tenian_manage],
  ['', ''],
  ['PADRE PUBLICADO — tallas', R.publicado_tallas],
  ['PADRE PUBLICADO — con precio en 0', R.publicado_precio_cero],
  ['PADRE PUBLICADO — con gestión de stock activa', R.publicado_manage],
  ['PADRE PUBLICADO — gestionadas y en 0', R.publicado_manage_cero],
  ['PADRE BORRADOR — tallas', R.borrador_tallas],
  ['PADRE BORRADOR — con precio en 0', R.borrador_precio_cero],
  ['', ''],
  ['AGOTADOS — productos PUBLICADOS 100 % agotados', R.agotados_totales_publicados],
  ['AGOTADOS — productos borrador 100 % agotados', R.agotados_totales_borrador],
  ['AGOTADOS — productos con agotado parcial', R.agotados_parciales],
  ['', ''],
  ['PROCEDENCIA — sobreescrituras de la carga del equipo', filas.filter(f => f.tieneOverride && f.procedencia === 'carga del equipo').length],
  ['PROCEDENCIA — sobreescrituras de PRUEBA (no deben escribirse)', filas.filter(f => f.tieneOverride && f.procedencia !== 'carga del equipo').length],
]
guardar('cobertura-resumen', 'Resumen', ['Concepto', 'Cantidad'], resumen, [56, 12])

// ---------- por consola ----------
console.log('\n════════ RESUMEN ════════')
for (const [k, v] of resumen) console.log(k ? `  ${String(k).padEnd(54)} ${v}` : '')
console.log('\n════════ PUBLICADOS QUE QUEDARÍAN 100 % AGOTADOS (los revisa Lesly) ════════')
const pubTot = totales.filter(p => p.estado === 'publish')
if (!pubTot.length) console.log('  ninguno')
for (const p of pubTot) console.log(`  ${p.codigo}  ${p.producto.padEnd(30)} ${p.tallas.length} tallas: ${p.tallas.map(t => t.talla).join(', ')}`)
console.log('\n════════ AGOTADO PARCIAL ════════')
if (!parciales.length) console.log('  ninguno')
for (const p of parciales) console.log(`  ${p.codigo}  ${p.producto.padEnd(30)} agotadas: ${p.outs.map(t => t.talla).join(', ')}  |  quedan: ${p.tallas.filter(t => !agotadaF(t)).map(t => t.talla).join(', ') || '—'}`)
