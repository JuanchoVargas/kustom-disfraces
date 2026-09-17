// RESTAURAR EL STOCK DE WOO desde un respaldo de scripts/respaldo-woo.mjs.
//
//   node scripts/restaurar-woo.mjs [respaldo.json]                       → EN SECO (no escribe)
//   node scripts/restaurar-woo.mjs [respaldo.json] --sku 001006004-P     → solo ese producto (o --sku <SKU de talla>); repetible / por comas
//   node scripts/restaurar-woo.mjs [respaldo.json] <https://servidor> --aplicar
//
// Sin archivo usa el respaldo MÁS RECIENTE de backups/. Restaura SOLO manage_stock,
// stock_quantity y stock_status. Nunca precio, imágenes ni estado del producto.
//
// EN SECO (por defecto): lee de Woo con la llave de SOLO LECTURA lo que hay HOY, lo
// compara con el respaldo y lista qué cambiaría, variación por variación. No necesita
// servidor ni sesión.
//
// --aplicar: la llave de ESCRITURA no existe en local (vive solo en Vercel), así que la
// escritura la hace el SERVIDOR que se indique, en POST /api/inventario/restaurar-woo,
// por el adaptador woo y con su guarda (NUXT_INVENTORY_WOO_ONLY_DRAFTS +
// NUXT_INVENTORY_WOO_ALLOW): lo que la guarda no deje escribir sale como fallido.
// Exige la URL del servidor de forma explícita y la contraseña del panel en .env
// (NUXT_INBOX_PASSWORD_PROD para un servidor público, NUXT_INBOX_PASSWORD para localhost).
// Al terminar vuelve a leer Woo y confirma que coincide con el respaldo.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cargarEnvLocal, clienteWooLectura, limpio, variacionesDe } from './lib/woo-lectura.mjs'
import { calcularRestauracion, txt } from './lib/restauracion-woo.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const APLICAR = args.includes('--aplicar')
const BASE = args.find(a => /^https?:\/\//.test(a))?.replace(/\/$/, '') ?? null
const soloSkus = args.flatMap((a, i) => (a === '--sku' && args[i + 1] ? args[i + 1].split(',') : [])).map(s => s.trim()).filter(Boolean)
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null }
const AUTOR = opt('--autor') ?? 'restaurar-woo.mjs'
let archivo = args.find(a => a.endsWith('.json'))
if (!archivo) {
  const ultimos = readdirSync(`${root}backups`).filter(f => /^woo-productos-variaciones-.*\.json$/.test(f)).sort()
  if (!ultimos.length) { console.error('❌ No hay respaldos en backups/. Corre primero: node scripts/respaldo-woo.mjs'); process.exit(1) }
  archivo = `backups/${ultimos.at(-1)}`
}

try {
  const datos = JSON.parse(readFileSync(archivo.match(/^([A-Za-z]:|\/)/) ? archivo : root + archivo, 'utf8'))
  console.log(`— Restaurar stock de Woo — respaldo ${archivo} (tomado ${datos.tomado_utc})`)
  console.log(`   modo: ${APLICAR ? `APLICAR en ${BASE ?? '(falta la URL del servidor)'}` : 'EN SECO (no escribe)'}${soloSkus.length ? ` · solo: ${soloSkus.join(', ')}` : ''}\n`)
  const woo = clienteWooLectura()
  if (woo.origen !== datos.origen) { console.error(`❌ El respaldo es de ${datos.origen} y .env apunta a ${woo.origen}. No se sigue.`); process.exit(1) }
  const enAlcance = datos.productos.filter(p => p.variaciones.length && (!soloSkus.length || soloSkus.includes(p.sku) || p.variaciones.some(v => soloSkus.includes(v.sku))))
  if (!enAlcance.length) { console.error('❌ Ningún producto del respaldo coincide con --sku.'); process.exit(1) }
  const leer = () => variacionesDe(woo, enAlcance.map(p => ({ id: p.id, type: 'variable' })))
  const { cambios, avisos, iguales } = calcularRestauracion(enAlcance, await leer(), soloSkus)

  for (const a of avisos) console.log(`⚠️  ${a}`)
  console.log(`Variaciones revisadas: ${cambios.length + iguales} · ya coinciden con el respaldo: ${iguales} · a restaurar: ${cambios.length}`)
  if (!cambios.length) { console.log('\n✅ Nada que restaurar: Woo ya está como en el respaldo.'); process.exit(0) }
  console.log('\n' + 'SKU'.padEnd(24) + 'PRODUCTO'.padEnd(30) + 'HOY EN WOO'.padEnd(30) + '→ RESPALDO')
  for (const c of cambios) console.log(c.sku.padEnd(24) + `${c.producto.slice(0, 22)} [${c.estado}]`.padEnd(30) + txt(c.antes).padEnd(30) + txt(c.despues))
  console.log('\nSolo se escriben manage_stock, stock_quantity y stock_status. Precios, imágenes y estado no se tocan.')

  if (!APLICAR) { console.log('\nEN SECO. Para ejecutar: añade la URL del servidor y --aplicar.'); process.exit(0) }
  if (!BASE) { console.error('\n❌ --aplicar exige la URL del servidor que escribirá (p. ej. https://www.disfraceskustom.com).'); process.exit(1) }

  const env = cargarEnvLocal()
  const esLocal = /localhost|127\.0\.0\.1/.test(BASE)
  const password = esLocal ? env.NUXT_INBOX_PASSWORD : (env.NUXT_INBOX_PASSWORD_PROD || env.NUXT_INBOX_PASSWORD)
  if (!password) { console.error(`❌ Falta ${esLocal ? 'NUXT_INBOX_PASSWORD' : 'NUXT_INBOX_PASSWORD_PROD'} en .env`); process.exit(1) }
  const login = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
  if (!login.ok) { console.error(`❌ Login falló (${login.status}) en ${BASE}`); process.exit(1) }
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]

  let fallidas = 0
  for (let i = 0; i < cambios.length; i += 100) {
    const tanda = cambios.slice(i, i + 100)
    const res = await fetch(`${BASE}/api/inventario/restaurar-woo`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ autor: AUTOR, variaciones: tanda.map(c => ({ sku: c.sku, ...c.despues })) }) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { console.error(`❌ tanda ${i / 100 + 1}: ${res.status} ${json?.statusMessage ?? ''} — se detiene aquí`); process.exit(1) }
    fallidas += json.fallidas
    console.log(`tanda ${i / 100 + 1}: restauradas ${json.restauradas} · fallidas ${json.fallidas}`)
    for (const r of json.resultados.filter(r => !r.ok)) console.log(`   ❌ ${r.sku}: ${r.error}`)
  }

  // Lectura de vuelta: Woo debe coincidir con el respaldo.
  const despues = calcularRestauracion(enAlcance, await leer(), soloSkus)
  console.log(`\nLectura de vuelta desde Woo: ${despues.cambios.length} variación(es) siguen distintas al respaldo.`)
  for (const c of despues.cambios) console.log(`   ${c.sku}: ${txt(c.antes)}  (respaldo: ${txt(c.despues)})`)
  console.log(despues.cambios.length || fallidas ? '\n❌ La restauración quedó incompleta.' : '\n✅ Woo coincide con el respaldo.')
  process.exit(despues.cambios.length || fallidas ? 1 : 0)
}
catch (err) {
  console.error('❌', limpio(err))
  process.exit(1)
}
