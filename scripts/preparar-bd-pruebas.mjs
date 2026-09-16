// PREPARA LA BASE DE PRUEBAS — rama de Neon marcada como base de tests.
//
//   node scripts/preparar-bd-pruebas.mjs                          → comprueba, no escribe
//   node scripts/preparar-bd-pruebas.mjs --url "postgresql://…"   → vista previa con esa rama
//   node scripts/preparar-bd-pruebas.mjs --url "postgresql://…" --confirmar
//        → genera .env.test (copia de .env con SOLO la base cambiada) y crea el marcador
//
// ANTES: en la consola de Neon → Branches → New branch, desde production, nombre
// "pruebas". Copia su cadena de conexión (la *pooled*) y pásala en --url.
//
// Se NIEGA a marcar la base si su endpoint de Neon coincide con el de producción:
// el marcador es lo único que habilita a los tests a escribir, así que ponerlo en
// producción desarmaría la protección entera.
//
// Motivo de todo esto: el 10/09 `test-inventario.mjs` corrió contra producción y
// borró sobreescrituras reales del equipo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { cargarEnv, endpointDe, TEST_MARKER_TABLE } from './lib/guard-bd.mjs'

const args = process.argv.slice(2)
const CONFIRMAR = args.includes('--confirmar')
const opt = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null }

const rutaEnv = fileURLToPath(new URL('../.env', import.meta.url))
const rutaEnvTest = fileURLToPath(new URL('../.env.test', import.meta.url))

const prod = cargarEnv('.env')
const urlProd = prod.POSTGRES_URL || prod.DATABASE_URL
const yaTest = existsSync(rutaEnvTest) ? cargarEnv('.env.test') : {}
const urlTest = opt('--url') || yaTest.POSTGRES_URL || yaTest.DATABASE_URL

console.log('— Preparación de la base de PRUEBAS —\n')

if (!urlTest) {
  console.error('❌ Falta la cadena de conexión de la rama de pruebas.\n')
  console.error('   1. Consola de Neon → Branches → New branch, desde production, nombre "pruebas".')
  console.error('   2. Copia su cadena de conexión (pooled) y córrelo así:\n')
  console.error('        node scripts/preparar-bd-pruebas.mjs --url "postgresql://…" --confirmar\n')
  console.error('   Genera .env.test solo (copia de .env con la base cambiada); .env.test ya está ignorado por git.')
  process.exit(1)
}

const epTest = endpointDe(urlTest)
const epProd = endpointDe(urlProd)
console.log(`   endpoint de PRODUCCIÓN : ${epProd || '(no configurado)'}`)
console.log(`   endpoint de PRUEBAS    : ${epTest || '(ilegible)'}`)

if (!epTest) {
  console.error('\n❌ La cadena de conexión no parece válida (no se pudo leer el endpoint ep-…).')
  process.exit(1)
}
if (epProd && epTest === epProd) {
  console.error('\n❌ ABORTADO: esa cadena apunta al MISMO endpoint que producción.')
  console.error('   Marcar producción como "base de pruebas" desarmaría la protección entera.')
  console.error('   Una rama de Neon tiene siempre un endpoint distinto (ep-…).')
  process.exit(1)
}

const sql = neon(urlTest)
let existe = false
try {
  const rows = await sql.query(`SELECT to_regclass($1) IS NOT NULL AS existe`, [`public.${TEST_MARKER_TABLE}`])
  existe = !!rows[0]?.existe
}
catch (err) {
  console.error('\n❌ No se pudo conectar a esa base:', String(err?.message ?? err))
  process.exit(1)
}
const tablas = await sql.query(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public'`)
console.log(`   tablas en esa base     : ${tablas[0].c}`)
console.log(`   marcador ${TEST_MARKER_TABLE} : ${existe ? '✅ ya está' : '— falta'}`)
console.log(`   archivo .env.test      : ${existsSync(rutaEnvTest) ? 'existe' : 'se creará'}`)

if (!CONFIRMAR) {
  console.log('\n(solo comprobación — nada escrito)')
  console.log('Para aplicar:  node scripts/preparar-bd-pruebas.mjs --url "…" --confirmar')
  process.exit(0)
}

// ---------- .env.test = copia de .env con SOLO la base cambiada ----------
// Nuxt carga un único archivo (`nuxt dev --dotenv .env.test`), así que tiene que
// ser completo: las llaves de Woo, la contraseña del panel, etc. se copian tal cual.
const CLAVES_BD = /^(POSTGRES_URL|POSTGRES_URL_NON_POOLING|POSTGRES_URL_NO_SSL|POSTGRES_PRISMA_URL|DATABASE_URL|DATABASE_URL_UNPOOLED|PGHOST|PGHOST_UNPOOLED|POSTGRES_HOST)=/
const sinPooler = urlTest.replace('-pooler.', '.')
const lineas = readFileSync(rutaEnv, 'utf8').split(/\r?\n/).filter(l => !CLAVES_BD.test(l.trim()))
const host = new URL(urlTest.replace(/^postgres(ql)?:/, 'http:')).hostname
const bloque = [
  '',
  '# ───────── BASE DE PRUEBAS (rama de Neon) ─────────',
  '# Generado por scripts/preparar-bd-pruebas.mjs. NO es producción.',
  `# endpoint: ${epTest}`,
  `POSTGRES_URL=${urlTest}`,
  `DATABASE_URL=${urlTest}`,
  `POSTGRES_URL_NON_POOLING=${sinPooler}`,
  `DATABASE_URL_UNPOOLED=${sinPooler}`,
  `PGHOST=${host}`,
  `POSTGRES_HOST=${host}`,
  '',
]
writeFileSync(rutaEnvTest, [...lineas, ...bloque].join('\n'))
console.log(`\n✅ .env.test escrito (copia de .env con la base apuntando a ${epTest}).`)

// ---------- marcador ----------
await sql.query(`CREATE TABLE IF NOT EXISTS ${TEST_MARKER_TABLE} (
  id        INTEGER PRIMARY KEY DEFAULT 1,
  nota      TEXT NOT NULL,
  endpoint  TEXT NOT NULL,
  creada_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)
await sql.query(
  `INSERT INTO ${TEST_MARKER_TABLE} (id, nota, endpoint) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET endpoint = EXCLUDED.endpoint`,
  ['Rama de PRUEBAS de Kustom. Los scripts que escriben solo corren si existe esta tabla. NO crear en producción.', epTest],
)
console.log(`✅ Marcador ${TEST_MARKER_TABLE} creado en la rama de pruebas.`)
console.log('\nYa puedes:')
console.log('   npm run dev:test                     (servidor contra la rama de pruebas)')
console.log('   node scripts/test-inventario.mjs     (ahora sí arranca)')
