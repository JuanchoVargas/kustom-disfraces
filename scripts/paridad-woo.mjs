// Verificación de paridad: catálogo local vs proxy Woo (/api/products).
// Uso: levantar el server (node .output/server/index.mjs) y correr
//   node scripts/paridad-woo.mjs [http://localhost:3000]
// Compara los ítems VISIBLES: mismos slugs, mismos precios, mismas tallas.
// Solo reporta — no cambia DATA_SOURCE ni escribe nada.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const local = JSON.parse(readFileSync(fileURLToPath(new URL('../app/data/catalogo.json', import.meta.url)), 'utf8'))

const res = await fetch(`${BASE}/api/products`)
if (!res.ok) {
  console.error(`El proxy respondió ${res.status} — ¿está corriendo el server en ${BASE}?`)
  process.exit(1)
}
const woo = await res.json()

const visibles = (arr) => new Map(arr.filter(i => i.disponibleWeb).map(i => [i.slug, i]))
const L = visibles(local)
const W = visibles(woo)

console.log(`visibles: local=${L.size} | woo=${W.size}`)

const soloLocal = [...L.keys()].filter(s => !W.has(s))
const soloWoo = [...W.keys()].filter(s => !L.has(s))
if (soloLocal.length) console.log(`\nSOLO EN LOCAL (${soloLocal.length}):`, soloLocal.join(', '))
if (soloWoo.length) console.log(`\nSOLO EN WOO (${soloWoo.length}):`, soloWoo.join(', '))

let okPrecio = 0, okTallas = 0
const difPrecio = [], difTallas = []
for (const [slug, l] of L) {
  const w = W.get(slug)
  if (!w) continue
  if (l.precio === w.precio) okPrecio++
  else difPrecio.push(`${slug}: local=${l.precio} woo=${w.precio}`)
  if (JSON.stringify(l.tallas) === JSON.stringify(w.tallas)) okTallas++
  else difTallas.push(`${slug}: local=[${l.tallas}] woo=[${w.tallas}]`)
}

const comunes = [...L.keys()].filter(s => W.has(s)).length
console.log(`\ncomunes: ${comunes}`)
console.log(`precios iguales: ${okPrecio}/${comunes}`)
difPrecio.slice(0, 70).forEach(d => console.log('  ≠ precio ·', d))
console.log(`tallas iguales: ${okTallas}/${comunes}`)
difTallas.slice(0, 70).forEach(d => console.log('  ≠ tallas ·', d))

const paridad = soloLocal.length === 0 && soloWoo.length === 0 && difPrecio.length === 0 && difTallas.length === 0
console.log(`\nPARIDAD: ${paridad ? 'OK — listo para DATA_SOURCE=woo' : 'CON DIFERENCIAS — no cambiar el flag'}`)
process.exit(paridad ? 0 : 2)
