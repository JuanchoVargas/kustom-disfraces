// Pruebas de la SINCRONIZACIÓN del snapshot (sin red, sin BD).
//
//   node scripts/test-sincronizacion.mjs
//
// Cubre lo que antes fallaba en silencio:
//   C.5  dos productos con el mismo SKU → se REPORTAN los dos, no se fusionan
//   C.4  productos sin SKU → se reportan con motivo y enlace a WordPress
//   C.6  el forzado de sincronización alcanza TODAS las tandas, no solo la primera
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({ wooBaseUrl: 'https://api.disfraceskustom.com', public: {} })
// Auto-imports de Nitro que inventorySnapshot arrastra por su cadena de imports.
globalThis.defineCachedFunction = fn => fn
globalThis.cachedFunction = fn => fn
globalThis.defineEventHandler = fn => fn
globalThis.createError = (e) => { const x = new Error(e?.statusMessage ?? 'error'); Object.assign(x, e); return x }
const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const { clasificarDescartes } = await jiti.import('../server/utils/inventorySnapshot.ts')

let fails = 0
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fails++
}

// ---------- C.5 · SKU duplicado entre padres ----------
console.log('— C.5 · dos productos con el mismo SKU —')
const lista = [
  { id: 1, sku: '001001001', name: 'Spider-Man Clásico', status: 'publish', type: 'variable' },
  { id: 2, sku: 'REPETIDO', name: 'Producto A', status: 'publish', type: 'variable' },
  { id: 3, sku: 'REPETIDO', name: 'Producto B (copia)', status: 'draft', type: 'variable' },
  { id: 4, sku: '', name: 'KOKUSHIBO', status: 'draft', type: 'simple' },
  { id: 5, sku: '', name: 'HARLEY QUEEN', status: 'draft', type: 'simple' },
]
const { guardar, descartados } = clasificarDescartes(lista)

check('el producto sano sí se guarda', guardar.length === 1 && guardar[0].sku === '001001001', `guardados=${guardar.map(p => p.sku).join(',')}`)
const dups = descartados.filter(d => d.motivo === 'SKU duplicado')
check('los DOS productos que chocan se reportan (ninguno gana en silencio)', dups.length === 2, `reportados=${dups.map(d => `#${d.id}`).join(' ')}`)
check('ninguno de los dos entra al snapshot', !guardar.some(p => p.sku === 'REPETIDO'))
check('el motivo dice "SKU duplicado"', dups.every(d => d.motivo === 'SKU duplicado'))
check('cada uno indica con quién choca', dups[0]?.choca_con?.[0]?.id === 3 && dups[1]?.choca_con?.[0]?.id === 2,
  dups.map(d => `#${d.id}→${d.choca_con?.map(c => `#${c.id} ${c.nombre}`).join('/')}`).join(' · '))
check('lleva enlace para editarlo en WordPress', dups.every(d => d.editar_url.includes('/wp-admin/post.php?post=') && d.editar_url.includes('action=edit')), dups[0]?.editar_url)

// ---------- C.4 · productos sin SKU ----------
console.log('\n— C.4 · productos sin SKU —')
const sin = descartados.filter(d => d.motivo === 'sin SKU')
check('se reportan los dos sin SKU (antes se descartaban en silencio)', sin.length === 2, sin.map(d => `#${d.id} ${d.nombre}`).join(' · '))
check('conservan el nombre para poder identificarlos', sin.some(d => d.nombre === 'KOKUSHIBO') && sin.some(d => d.nombre === 'HARLEY QUEEN'))
check('llevan enlace a WordPress', sin.every(d => d.editar_url.includes('post=')))

// ---------- C.6 · el forzado recorre todas las tandas ----------
// Se replica la decisión de frescura de syncStep: con `desde`, "fresco" = ya
// releído EN ESTA tanda; sin `desde`, = leído hace menos de 10 min.
console.log('\n— C.6 · sincronización forzada, todas las tandas —')
const FRESH_MS = 10 * 60 * 1000
const SYNC_CHUNK = 12
function simular({ productos, usarDesde }) {
  const ahora = Date.parse('2026-09-11T10:00:00Z')
  // Todos recién sincronizados hace 2 min: con la lógica vieja cuentan como frescos.
  const snap = new Map(productos.map(sku => [sku, { fetched_at: new Date(ahora - 2 * 60 * 1000).toISOString() }]))
  const desde = usarDesde ? new Date(ahora).toISOString() : undefined
  let procesados = 0
  for (let i = 0; i < 60; i++) {
    const force = true
    const needs = []
    for (const sku of productos) {
      const prev = snap.get(sku)
      const releidoYa = desde ? prev != null && prev.fetched_at >= desde : false
      const reciente = prev != null && ahora - Date.parse(prev.fetched_at) < FRESH_MS
      const fresh = prev && (desde ? releidoYa : reciente)
      if ((force && !desde) || !fresh) needs.push(sku)
    }
    const chunk = needs.slice(0, SYNC_CHUNK)
    for (const sku of chunk) { snap.set(sku, { fetched_at: new Date(ahora).toISOString() }); procesados++ }
    if (needs.length - chunk.length <= 0) break
    if (i === 59) return { procesados, bucle: true }
  }
  return { procesados, bucle: false }
}
const N = 109
// Comportamiento ANTERIOR: el panel mandaba force solo en la primera llamada.
function simularViejo(productos) {
  const ahora = Date.parse('2026-09-11T10:00:00Z')
  const snap = new Map(productos.map(sku => [sku, { fetched_at: new Date(ahora - 2 * 60 * 1000).toISOString() }]))
  let procesados = 0
  for (let i = 0; i < 60; i++) {
    const force = i === 0
    const needs = productos.filter((sku) => {
      const prev = snap.get(sku)
      const fresh = prev && ahora - Date.parse(prev.fetched_at) < FRESH_MS
      return force || !fresh
    })
    const chunk = needs.slice(0, SYNC_CHUNK)
    for (const sku of chunk) { snap.set(sku, { fetched_at: new Date(ahora).toISOString() }); procesados++ }
    if (needs.length - chunk.length <= 0) break
  }
  return procesados
}
const catalogo = Array.from({ length: N }, (_, i) => `P${i}`)
const viejo = simularViejo(catalogo)
const nuevo = simular({ productos: catalogo, usarDesde: true })
check(`el comportamiento ANTERIOR solo releía la primera tanda`, viejo === SYNC_CHUNK, `releídos=${viejo} de ${N}`)
check('con `desde`, el forzado recorre el catálogo COMPLETO', nuevo.procesados === N, `releídos=${nuevo.procesados} de ${N}`)
check('y no entra en bucle reprocesando los mismos', !nuevo.bucle)

console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
