// RESPALDO COMPLETO de la carga de inventario. SOLO LECTURA sobre la base.
//
//   node scripts/respaldo-inventario.mjs
//
// Vuelca `inventory_overrides` e `inventory_changes` a backups/, fechados, en dos
// formatos: .xlsx (para abrirlo y revisarlo) y .sql (para restaurar tal cual).
//
// Son el trabajo de carga del equipo y NO existen en ningún otro sitio: Woo no los
// tiene (el panel está en modo práctica) y Neon free no da point-in-time útil a
// estas alturas. Se corre ANTES de cualquier borrado.
//
// El .sql trae BEGIN/COMMIT y usa INSERT … ON CONFLICT DO NOTHING, así que se
// puede reaplicar sobre una base que ya tenga filas sin duplicar ni pisar.
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs'
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

const sql = neon(env.POSTGRES_URL || env.DATABASE_URL)
const fecha = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const dir = `${root}backups`
mkdirSync(dir, { recursive: true })

/** Literal SQL de un valor de Postgres, tipado como lo devuelve el driver. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return `'${v.toISOString()}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

async function respaldar(tabla, orden) {
  const cols = (await sql.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [tabla],
  )).map(c => c.column_name)
  if (!cols.length) throw new Error(`la tabla ${tabla} no existe`)
  const filas = await sql.query(`SELECT * FROM ${tabla} ORDER BY ${orden}`)

  // ---- .sql ----
  const cabecera = [
    `-- Respaldo de ${tabla} — ${new Date().toISOString()}`,
    `-- ${filas.length} filas · origen: endpoint ${new URL((env.POSTGRES_URL || '').replace(/^postgres(ql)?:/, 'http:')).hostname.split('.')[0]}`,
    `-- Restaurar:  psql "<cadena>" -f ${tabla}-${fecha}.sql`,
    'BEGIN;',
    '',
  ]
  const lineas = filas.map(f => `INSERT INTO ${tabla} (${cols.join(', ')}) VALUES (${cols.map(c => lit(f[c])).join(', ')}) ON CONFLICT DO NOTHING;`)
  const rutaSql = `${dir}/${tabla}-${fecha}.sql`
  writeFileSync(rutaSql, [...cabecera, ...lineas, '', 'COMMIT;', ''].join('\n'))

  // ---- .xlsx ----
  const rutaXlsx = `${dir}/${tabla}-${fecha}.xlsx`
  const celda = v => (v === null || v === undefined ? null : typeof v === 'number' ? v : v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : String(v))
  writeFileSync(rutaXlsx, writeXlsx(tabla, cols, filas.map(f => cols.map(c => celda(f[c]))), cols.map(c => Math.min(40, Math.max(12, c.length + 6)))))

  return { tabla, filas: filas.length, cols, rutaSql, rutaXlsx }
}

console.log('— Respaldo de inventario (solo lectura) —\n')
const r1 = await respaldar('inventory_overrides', 'sku')
const r2 = await respaldar('inventory_changes', 'id')

// ---- verificación de integridad del propio respaldo ----
let problemas = 0
for (const r of [r1, r2]) {
  const inserts = readFileSync(r.rutaSql, 'utf8').split('\n').filter(l => l.startsWith('INSERT INTO')).length
  const kbSql = Math.round(statSync(r.rutaSql).size / 1024)
  const kbXlsx = Math.round(statSync(r.rutaXlsx).size / 1024)
  const ok = inserts === r.filas && kbSql > 0 && kbXlsx > 0
  if (!ok) problemas++
  console.log(`${ok ? '✅' : '❌'} ${r.tabla}`)
  console.log(`     filas en la base : ${r.filas}`)
  console.log(`     INSERT en el .sql: ${inserts}${inserts === r.filas ? ' (coinciden)' : ' ⚠️ NO COINCIDEN'}`)
  console.log(`     columnas         : ${r.cols.join(', ')}`)
  console.log(`     ${r.rutaSql.replace(root, '')} (${kbSql} KB)`)
  console.log(`     ${r.rutaXlsx.replace(root, '')} (${kbXlsx} KB)`)
}
if (problemas) { console.error(`\n❌ El respaldo NO es fiable. No borres nada.`); process.exit(1) }
console.log(`\n✅ Respaldo completo y verificado. ${r1.filas} overrides · ${r2.filas} cambios.`)
