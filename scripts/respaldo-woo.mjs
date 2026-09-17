// RESPALDO DE WOOCOMMERCE — SOLO LECTURA (llave de solo lectura de .env).
//
//   node scripts/respaldo-woo.mjs
//
// Lee directo de Woo TODOS los productos (cualquier estado) y TODAS sus variaciones, y
// los guarda en backups/woo-productos-variaciones-<fecha>.json: precio, oferta,
// manage_stock, stock_quantity, stock_status e ids. Es la foto de "cómo estaba Woo"
// antes de aplicar el inventario; scripts/restaurar-woo.mjs devuelve el stock a esa foto.
//
// Complementa a respaldo-inventario.mjs, que respalda lo que vive en Neon
// (inventory_overrides e inventory_changes). backups/ está ignorado por git.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clienteWooLectura, limpio, variacionesDe } from './lib/woo-lectura.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
try {
  const t0 = Date.now()
  const woo = clienteWooLectura()
  console.log('— Respaldo de WooCommerce (solo lectura) —\n')
  const productos = await woo.todas('/products?status=any&orderby=id&order=asc')
  const vars = await variacionesDe(woo, productos, { progreso: (n, total) => console.log(`   ${n}/${total} productos…`) })
  const salida = productos.map(p => ({
    id: p.id, sku: p.sku, name: p.name, type: p.type, status: p.status,
    regular_price: p.regular_price, sale_price: p.sale_price, price: p.price,
    manage_stock: p.manage_stock, stock_quantity: p.stock_quantity ?? null, stock_status: p.stock_status,
    date_modified_gmt: p.date_modified_gmt,
    variaciones: vars.get(p.id) ?? [],
  })).sort((a, b) => a.id - b.id)

  const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  mkdirSync(`${root}backups`, { recursive: true })
  const rel = `backups/woo-productos-variaciones-${fecha}.json`
  writeFileSync(root + rel, JSON.stringify({ tomado_utc: new Date().toISOString(), origen: woo.origen, productos: salida }, null, 1))

  // Verificación del propio respaldo: se relee del disco y se cuenta.
  const leido = JSON.parse(readFileSync(root + rel, 'utf8')).productos
  const vs = leido.flatMap(p => p.variaciones)
  const esperadas = [...vars.values()].reduce((n, a) => n + a.length, 0)
  const ok = leido.length === productos.length && vs.length === esperadas && vs.every(v => v.id > 0)
  console.log(`\n${ok ? '✅' : '❌'} ${rel} (${Math.round(statSync(root + rel).size / 1024)} KB) en ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  console.log(`   productos  : ${leido.length} (publish ${leido.filter(p => p.status === 'publish').length} · draft ${leido.filter(p => p.status === 'draft').length} · otros ${leido.filter(p => !['publish', 'draft'].includes(p.status)).length})`)
  console.log(`   variaciones: ${vs.length} · con manage_stock: ${vs.filter(v => v.manage_stock).length} · outofstock: ${vs.filter(v => v.stock_status === 'outofstock').length} · sin precio: ${vs.filter(v => !v.regular_price).length}`)
  if (!ok) { console.error('\n❌ El respaldo NO es fiable (los conteos no cuadran). No apliques nada.'); process.exit(1) }
  console.log('\nPara volver a esta foto:  node scripts/restaurar-woo.mjs ' + rel)
}
catch (err) {
  console.error('❌', limpio(err))
  process.exit(1)
}
