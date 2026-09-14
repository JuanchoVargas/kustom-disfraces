// GUARDA DE BASE DE DATOS para los scripts que ESCRIBEN.
//
// El 10/09 `test-inventario.mjs` corrió contra producción y borró sobreescrituras
// reales del equipo (hubo que reconstruirlas desde inventory_changes). Esta guarda
// hace imposible repetirlo: ningún script que escriba arranca si la base no está
// marcada explícitamente como base de pruebas.
//
// Cómo se reconoce una base de pruebas: tiene la tabla `kustom_bd_pruebas`, que
// solo crea `scripts/preparar-bd-pruebas.mjs` y que producción NO tiene. Es un
// marcador POSITIVO: comparar cadenas de conexión falla en cuanto alguien copia
// mal una URL; esto solo da verde si la base fue preparada a propósito.
//
// Uso en un script que escribe:
//   import { exigirBdDePruebas } from './lib/guard-bd.mjs'
//   const { sql, BASE } = await exigirBdDePruebas()
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

export const TEST_MARKER_TABLE = 'kustom_bd_pruebas'

export function cargarEnv(archivo = '.env') {
  const env = {}
  try {
    const raw = readFileSync(fileURLToPath(new URL(`../../${archivo}`, import.meta.url)), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  }
  catch { /* sin archivo: se usa process.env */ }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) }
}

/** Endpoint de Neon (ep-xxxx) de una cadena de conexión. Identifica la RAMA. */
export function endpointDe(url) {
  try {
    const host = new URL(String(url).replace(/^postgres(ql)?:/, 'http:')).hostname
    return (host.split('.')[0] || '').replace(/-pooler$/, '')
  }
  catch { return '' }
}

function abortar(titulo, lineas) {
  console.error(`\n❌ ${titulo}\n`)
  for (const l of lineas) console.error(`   ${l}`)
  console.error('')
  process.exit(1)
}

const COMO_PREPARAR = [
  'Cómo preparar la base de pruebas (una sola vez):',
  '  1. Consola de Neon → Branches → New branch, desde production, nombre "pruebas".',
  '     Copia su cadena de conexión (la pooled). Tendrá otro endpoint ep-…',
  '  2. node scripts/preparar-bd-pruebas.mjs --url "postgresql://…" --confirmar',
  '     (genera .env.test como copia de .env con solo la base cambiada, y marca la rama)',
  '  3. npm run dev:test        ← el servidor queda apuntando a la rama de pruebas',
  '  4. Vuelve a correr este script.',
]

/**
 * Cliente SQL contra la base de PRUEBAS. Tres barreras:
 *   1. hay que definir POSTGRES_URL en .env.test,
 *   2. su endpoint de Neon debe ser DISTINTO al de producción (.env),
 *   3. la base debe tener el marcador `kustom_bd_pruebas`.
 */
export async function sqlDePruebas() {
  const prod = cargarEnv('.env')
  const test = cargarEnv('.env.test')
  const urlTest = test.POSTGRES_URL_TEST || test.POSTGRES_URL || test.DATABASE_URL
  const urlProd = prod.POSTGRES_URL || prod.DATABASE_URL

  if (!urlTest) {
    abortar('No hay base de pruebas configurada.', ['Falta .env.test con POSTGRES_URL de la rama de pruebas.', '', ...COMO_PREPARAR])
  }
  const epTest = endpointDe(urlTest)
  const epProd = endpointDe(urlProd)
  if (!epTest) abortar('La cadena de conexión de pruebas no es válida.', [`No se pudo leer el endpoint de: ${String(urlTest).slice(0, 40)}…`])
  if (epProd && epTest === epProd) {
    abortar('La "base de pruebas" ES la de producción.', [
      `Ambas apuntan al endpoint ${epTest}.`,
      'Una rama de Neon tiene SIEMPRE un endpoint distinto (ep-…).',
      '', ...COMO_PREPARAR,
    ])
  }

  const sql = neon(urlTest)
  let marcada = false
  try {
    const rows = await sql.query(`SELECT to_regclass($1) IS NOT NULL AS existe`, [`public.${TEST_MARKER_TABLE}`])
    marcada = !!rows[0]?.existe
  }
  catch (err) {
    abortar('No se pudo conectar a la base de pruebas.', [String(err?.message ?? err)])
  }
  if (!marcada) {
    abortar('Esa base NO está marcada como base de pruebas.', [
      `Le falta la tabla ${TEST_MARKER_TABLE} (endpoint ${epTest}).`,
      'Se exige un marcador POSITIVO justamente para que una URL mal copiada no pase.',
      '', ...COMO_PREPARAR,
    ])
  }
  return { sql, endpoint: epTest, url: urlTest }
}

/**
 * Comprueba que el SERVIDOR contra el que apuntan los tests está usando la base de
 * pruebas. No basta con que el script use la buena: los tests hacen peticiones HTTP
 * y es el servidor quien escribe.
 */
export async function exigirServidorDePruebas(baseUrl = 'http://localhost:3000') {
  let info
  try {
    const r = await fetch(`${baseUrl}/api/version`)
    info = await r.json()
  }
  catch (err) {
    abortar(`No responde el servidor en ${baseUrl}.`, [String(err?.message ?? err), '', 'Levántalo con: npm run dev:test'])
  }
  if (info?.db_test !== true) {
    abortar(`El servidor de ${baseUrl} NO está usando la base de pruebas.`, [
      `/api/version devolvió db_test=${JSON.stringify(info?.db_test)} (entorno ${info?.entorno ?? '?'}).`,
      'Ese servidor escribe en PRODUCCIÓN: los tests no van a correr contra él.',
      '', ...COMO_PREPARAR,
    ])
  }
  return info
}

/** Guarda completa: servidor de pruebas + cliente SQL de pruebas. */
export async function exigirBdDePruebas(baseUrl = 'http://localhost:3000') {
  const info = await exigirServidorDePruebas(baseUrl)
  const { sql, endpoint } = await sqlDePruebas()
  console.log(`🧪 base de pruebas OK — endpoint ${endpoint} · servidor ${baseUrl} (${info.entorno ?? 'local'})`)
  return { sql, BASE: baseUrl, endpoint, info }
}
