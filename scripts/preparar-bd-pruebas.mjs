// PREPARA LA BASE DE PRUEBAS — rama de Neon marcada como base de tests.
//
//   node scripts/preparar-bd-pruebas.mjs                          → comprueba, no escribe
//   node scripts/preparar-bd-pruebas.mjs --confirmar
//        → genera .env.test (SIN credenciales de salida, ver abajo) y crea el marcador
//   (--url "postgresql://…" también vale, pero deja la cadena en el historial de la terminal)
//
// ANTES: en la consola de Neon → Branches → New branch, desde production, nombre
// "pruebas". Copia su cadena de conexión (la *pooled*) y pégala en .env.test como
// única línea: POSTGRES_URL=<cadena>. El script la lee de ahí y reescribe el archivo.
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
  console.error('   2. Copia su cadena de conexión (pooled) y pégala en .env.test como única línea:\n')
  console.error('        POSTGRES_URL=<cadena>\n')
  console.error('   3. node scripts/preparar-bd-pruebas.mjs --confirmar\n')
  console.error('   Reescribe .env.test completo, sin credenciales de salida; .env.test ya está ignorado por git.')
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
  console.log('Para aplicar:  node scripts/preparar-bd-pruebas.mjs --confirmar')
  process.exit(0)
}

// ---------- .env.test = copia de .env SIN credenciales de salida y con la base de pruebas ----------
// Nuxt carga un único archivo (`nuxt dev --dotenv .env.test`), así que tiene que ser
// completo. Pero un entorno de pruebas NO debe poder hablar con el mundo real:
//
//  1. BASE: se quita TODO lo de Postgres de producción (también usuario y contraseña,
//     que antes se copiaban) y se escribe solo la rama de pruebas.
//  2. SALIDA: se VACÍA toda credencial con la que el servidor local podría escribir o
//     enviar algo de verdad: WhatsApp, Messenger, correo (SMTP), Mercado Pago, llaves de
//     ESCRITURA de Woo, WordPress (medios), alertas, pixel y la contraseña del panel de
//     producción. Las pruebas ya enviaron correos reales a ventas@ por esto.
//  3. SECRETOS LOCALES: NUXT_META_APP_SECRET y CRON_SECRET no se copian nunca. Como los
//     webhooks y los crons son fail-closed, se generan valores ALEATORIOS locales (o se
//     conservan los que ya hubiera en .env.test). No tienen nada que ver con producción.
//  4. Se conservan: la llave de SOLO LECTURA de Woo (las suites leen el catálogo), la
//     contraseña local del panel, NUXT_SKUS_AGOTADOS y las variables públicas.
//  5. MP_ACCESS_TOKEN queda con un marcador "TEST-local-sin-credenciales": el endpoint
//     del checkout exige que exista para validar precios y stock (409), pero con ese
//     valor jamás se crea una preferencia real en Mercado Pago.
const ES_BD = /^(POSTGRES_|DATABASE_URL|PG(HOST|USER|PASSWORD|DATABASE|PORT))/
const ES_SALIDA = [
  /^(NUXT_)?WHATSAPP_(TOKEN|PHONE_ID)$/, /^NUXT_ALERT_WHATSAPP_TO$/,
  /^(NUXT_)?MESSENGER_PAGE_TOKEN$/,
  /^(NUXT_)?SMTP_(HOST|PORT|USER|PASS|FROM)$/, /^(NUXT_)?RESEND_/,
  /^(NUXT_)?MP_(WEBHOOK_SECRET|PUBLIC_KEY)$/, /^NUXT_PUBLIC_MP_PUBLIC_KEY$/,
  /^(NUXT_)?WOO_(WRITE|ORDERS)_CONSUMER_(KEY|SECRET)$/,
  /^(NUXT_)?WP_APP_(USER|PASSWORD)$/,
  /^NUXT_INBOX_PASSWORD_PROD$/,
  /^NUXT_PUBLIC_META_PIXEL_ID$/, /^NUXT_META_CAPI_TOKEN$/, /^NUXT_MESSENGER_APP_SECRET$/,
  /^BLOB_READ_WRITE_TOKEN$/,
]
const ES_MP_TOKEN = /^(NUXT_)?MP_ACCESS_TOKEN$/
const ES_SECRETO_LOCAL = /^(NUXT_META_APP_SECRET|CRON_SECRET)$/
const MP_MARCADOR = 'TEST-local-sin-credenciales'

const { randomBytes } = await import('node:crypto')
const vaciadas = []
const lineas = []
let hayMpToken = false
for (const linea of readFileSync(rutaEnv, 'utf8').split(/\r?\n/)) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) { lineas.push(linea); continue }
  const [, clave, valor] = m
  if (ES_BD.test(clave) || ES_SECRETO_LOCAL.test(clave)) continue // se reescriben abajo
  if (ES_MP_TOKEN.test(clave)) { hayMpToken = true; if (valor.trim()) vaciadas.push(clave); lineas.push(`${clave}=${MP_MARCADOR}`); continue }
  if (ES_SALIDA.some(re => re.test(clave))) { if (valor.trim()) vaciadas.push(clave); lineas.push(`${clave}=`); continue }
  lineas.push(linea)
}
if (!hayMpToken) lineas.push(`MP_ACCESS_TOKEN=${MP_MARCADOR}`)

const sinPooler = urlTest.replace('-pooler.', '.')
const host = new URL(urlTest.replace(/^postgres(ql)?:/, 'http:')).hostname
const local = clave => (yaTest[clave] && String(yaTest[clave]).trim()) || randomBytes(32).toString('hex')
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
  '# ───────── SECRETOS LOCALES (aleatorios; NO son los de producción) ─────────',
  '# Los webhooks de Meta y los crons son fail-closed: sin esto las suites darían 401.',
  `NUXT_META_APP_SECRET=${local('NUXT_META_APP_SECRET')}`,
  `CRON_SECRET=${local('CRON_SECRET')}`,
  '',
]
writeFileSync(rutaEnvTest, [...lineas, ...bloque].join('\n'))
console.log(`\n✅ .env.test escrito: base apuntando a ${epTest}, sin credenciales de salida.`)
console.log(`   credenciales de producción VACIADAS (${vaciadas.length}): ${vaciadas.join(', ') || 'ninguna tenía valor'}`)
console.log('   Postgres de producción: quitado por completo (URL, host, usuario y contraseña)')
console.log(`   secretos locales: NUXT_META_APP_SECRET y CRON_SECRET ${yaTest.NUXT_META_APP_SECRET || yaTest.CRON_SECRET ? 'conservados de .env.test / ' : ''}generados al azar`)
console.log('   conservadas: llave de SOLO LECTURA de Woo, NUXT_INBOX_PASSWORD, NUXT_SKUS_AGOTADOS y variables públicas')

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
