// Prueba de RETENCIÓN y TOPE de medios de la bandeja contra un dev server local
// (npm run dev + POSTGRES_URL + NUXT_INBOX_PASSWORD en .env). Inserta filas de
// prueba directamente en Neon y las limpia al final.
//
//   node scripts/test-media-retencion.mjs [baseUrl]   (default http://localhost:3000)
//
// Escenarios:
//   1. /api/admin/media-stats responde (con sesión) y 401 sin sesión.
//   2. Retención: un medio con 61 días y su mensaje → tras /api/cron/keepalive el
//      medio desaparece, el mensaje sigue con meta.expirado = true y /api/media/<token> da 404.
//      Un medio de hoy NO se borra.
//   3. Tope total: con una fila "gorda" (bytes = tope) un adjunto que llega por
//      Messenger se registra como mensaje pero NO se guarda (download_failed =
//      limite_almacenamiento); enviar una imagen desde la bandeja responde 507.
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = process.argv.slice(2).find(a => a.startsWith('http')) ?? 'http://localhost:3000'
function loadEnv() {
  const env = {}
  const raw = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim()
  }
  return env
}
const env = loadEnv()
const sql = neon(env.POSTGRES_URL || env.DATABASE_URL)
let fails = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) fails++ }
const PSID = '9990000000000077'
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function cleanup() {
  await sql.query(`DELETE FROM conversations WHERE canal = 'msg' AND external_id = $1`, [PSID])
  await sql.query(`DELETE FROM media WHERE filename LIKE 'test-retencion-%'`)
}
await cleanup()

// sesión
const noAuth = await fetch(`${BASE}/api/admin/media-stats`)
check('1. media-stats sin sesión → 401', noAuth.status === 401)
const login = await fetch(`${BASE}/api/inbox/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: env.NUXT_INBOX_PASSWORD }) })
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
const stats0 = await fetch(`${BASE}/api/admin/media-stats`, { headers: { cookie } }).then(r => r.json())
check('1. media-stats con sesión: bytes, archivos, tope y retención', stats0.db === true && typeof stats0.bytes === 'number' && stats0.limite_mb > 0 && stats0.retencion_dias > 0, `${stats0.mb} MB de ${stats0.limite_mb} · ${stats0.archivos} archivos · retención ${stats0.retencion_dias} d`)

// 2. retención
const conv = (await sql.query(`INSERT INTO conversations (canal, external_id, nombre) VALUES ('msg', $1, 'Prueba Retención') RETURNING id`, [PSID]))[0]
const old = (await sql.query(`INSERT INTO media (token, mime, bytes, filename, data, created_at) VALUES ($1, 'image/png', $2, 'test-retencion-viejo.png', $3, now() - interval '61 days') RETURNING id, token`, ['a'.repeat(32), TINY_PNG.length, TINY_PNG]))[0]
const fresh = (await sql.query(`INSERT INTO media (token, mime, bytes, filename, data) VALUES ($1, 'image/png', $2, 'test-retencion-nuevo.png', $3) RETURNING id, token`, ['b'.repeat(32), TINY_PNG.length, TINY_PNG]))[0]
const msgOld = (await sql.query(`INSERT INTO messages (conversation_id, direccion, texto, autor, tipo, media_id, meta) VALUES ($1, 'in', '[Imagen recibida]', 'cliente', 'image', $2, '{}'::jsonb) RETURNING id`, [conv.id, old.id]))[0]
const msgNew = (await sql.query(`INSERT INTO messages (conversation_id, direccion, texto, autor, tipo, media_id, meta) VALUES ($1, 'in', '[Imagen recibida]', 'cliente', 'image', $2, '{}'::jsonb) RETURNING id`, [conv.id, fresh.id]))[0]
const before = await fetch(`${BASE}/api/media/${old.token}`)
check('2. el medio viejo se sirve antes de la retención', before.status === 200)
const cron = await fetch(`${BASE}/api/cron/keepalive`).then(r => r.json())
check('2. /api/cron/keepalive corre la retención', cron.ok === true && cron.retencion?.borrados >= 1, JSON.stringify(cron.retencion))
const after = await fetch(`${BASE}/api/media/${old.token}`)
check('2. el medio de 61 días ya no existe (404)', after.status === 404)
const rowOld = (await sql.query(`SELECT media_id, meta, texto FROM messages WHERE id = $1`, [msgOld.id]))[0]
check('2. el mensaje se conserva con meta.expirado = true y sin media_id', rowOld && rowOld.media_id === null && rowOld.meta?.expirado === true && rowOld.texto === '[Imagen recibida]', JSON.stringify(rowOld))
const rowNew = (await sql.query(`SELECT media_id, meta FROM messages WHERE id = $1`, [msgNew.id]))[0]
const stillFresh = await fetch(`${BASE}/api/media/${fresh.token}`)
check('2. el medio de hoy sigue (no expira)', stillFresh.status === 200 && rowNew.media_id === fresh.id && !rowNew.meta?.expirado)
const convApi = await fetch(`${BASE}/api/inbox/conversations/${conv.id}`, { headers: { cookie } }).then(r => r.json())
const expMsg = convApi.messages?.find(m => Number(m.id) === Number(msgOld.id))
check('2. la bandeja recibe el mensaje expirado sin archivo y con meta.expirado', expMsg && expMsg.media === null && expMsg.meta?.expirado === true)

// 3. tope total
const limiteBytes = Number(stats0.limite_mb) * 1024 * 1024
await sql.query(`INSERT INTO media (token, mime, bytes, filename, data) VALUES ($1, 'application/octet-stream', $2, 'test-retencion-gordo.bin', $3)`, ['c'.repeat(32), limiteBytes, Buffer.from('x')])
const statsFull = await fetch(`${BASE}/api/admin/media-stats`, { headers: { cookie } }).then(r => r.json())
check('3. media-stats marca lleno al alcanzar el tope', statsFull.lleno === true && statsFull.pct >= 100, `${statsFull.mb} MB · ${statsFull.pct}%`)
const dataUrl = `data:image/png;base64,${TINY_PNG.toString('base64')}`
const hook = { object: 'page', entry: [{ id: '0', time: Date.now(), messaging: [{ sender: { id: PSID }, recipient: { id: '1' }, timestamp: Date.now(), message: { mid: `m.ret.${Date.now()}`, attachments: [{ type: 'image', payload: { url: dataUrl } }] } }] }] }
await fetch(`${BASE}/api/messenger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hook) })
const last = (await sql.query(`SELECT m.tipo, m.texto, m.media_id, m.meta FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.external_id = $1 AND m.direccion = 'in' ORDER BY m.id DESC LIMIT 1`, [PSID]))[0]
check('3. con el tope lleno, la foto entrante se registra pero NO se guarda (limite_almacenamiento)', last && last.tipo === 'image' && last.media_id === null && last.meta?.download_failed === 'limite_almacenamiento', JSON.stringify({ tipo: last?.tipo, meta: last?.meta }))
const fd = new FormData()
fd.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'foto.png')
const up = await fetch(`${BASE}/api/inbox/conversations/${conv.id}/media`, { method: 'POST', headers: { cookie }, body: fd })
check('3. enviar imagen desde la bandeja con el tope lleno → 507 storage_full', up.status === 507, `status ${up.status}`)

await cleanup()
console.log(fails ? `\n❌ ${fails} fallo(s)` : '\n✅ todo OK')
process.exit(fails ? 1 : 0)
