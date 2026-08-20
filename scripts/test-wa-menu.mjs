// Reproduce SIN DEPLOY el menú interactivo del bot y lo envía por la Cloud API.
// Uso:
//   node scripts/test-wa-menu.mjs <numero_destino> [menu|lista]
//     menu  (default) → menú de bienvenida (interactive.type=button), lo PRIMERO que envía el bot
//     lista           → lista de públicos (interactive.type=list)
// Lee NUXT_WHATSAPP_TOKEN y NUXT_WHATSAPP_PHONE_ID de .env. El <numero> va en
// formato internacional sin '+'. Usa SIEMPRE el número de prueba registrado
// 573154168607 — NUNCA 573118844547, que es la línea real del negocio. Imprime el payload exacto,
// las violaciones de límites y la respuesta de Graph (wamid o error). No hace deploy.
//
// Los payloads aquí replican EXACTAMENTE los de server/utils/whatsapp.ts
// (waButtons / waList) y whatsappBot.ts (mainMenu / publicosList).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GRAPH_VERSION = 'v21.0'
const to = process.argv[2]
const which = (process.argv[3] ?? 'menu').toLowerCase()
if (!to) {
  console.error('Falta el número destino.\nUso: node scripts/test-wa-menu.mjs <numero> [menu|lista]')
  process.exit(1)
}

// --- .env mínimo (sin dependencias) ---
function loadEnv() {
  const env = {}
  try {
    const raw = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '').trim()
    }
  }
  catch { /* sin .env: caemos a process.env */ }
  return env
}
const env = loadEnv()
const TOKEN = env.NUXT_WHATSAPP_TOKEN || process.env.NUXT_WHATSAPP_TOKEN
const PHONE_ID = env.NUXT_WHATSAPP_PHONE_ID || process.env.NUXT_WHATSAPP_PHONE_ID
if (!TOKEN || !PHONE_ID) {
  console.error('Faltan NUXT_WHATSAPP_TOKEN y/o NUXT_WHATSAPP_PHONE_ID en .env')
  process.exit(1)
}

// --- helpers espejo de server/utils/whatsapp.ts ---
const cut = (s, max) => { const t = [...String(s ?? '')]; return t.length > max ? t.slice(0, max).join('') : t.join('') }
const len = s => [...String(s ?? '')].length

function waButtons(body, buttons) {
  return { type: 'interactive', interactive: {
    type: 'button',
    body: { text: cut(body, 1024) },
    action: { buttons: buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) },
  } }
}
function waList(body, buttonLabel, rows, sectionTitle = 'Opciones') {
  return { type: 'interactive', interactive: {
    type: 'list',
    body: { text: cut(body, 1024) },
    action: { button: cut(buttonLabel, 20), sections: [{
      title: cut(sectionTitle, 24),
      rows: rows.slice(0, 10).map(r => ({ id: cut(r.id, 200), title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })),
    }] },
  } }
}

// --- payloads espejo del bot ---
function mainMenu() {
  return waButtons(
    '¡Hola! 👋 Soy el asistente de *Kustom Disfraces* 👽\n¿Qué quieres hacer?',
    [
      { id: 'main:ver', title: 'Ver disfraces' },
      { id: 'main:como', title: 'Cómo comprar' },
      { id: 'main:human', title: 'Hablar con alguien' },
    ],
  )
}
function publicosList() {
  // Públicos desde la taxonomía (mismo origen que catalogNav). El count real depende
  // del catálogo; aquí usamos "N disfraces" solo para reproducir el largo/estructura.
  const nav = JSON.parse(readFileSync(fileURLToPath(new URL('../app/data/navegacion.json', import.meta.url)), 'utf8'))
  const rows = nav.publicos
    .filter(p => p.slug !== 'combos')
    .map(p => ({ id: `pub:${p.slug}`, title: p.nombre, description: p.subcategorias.length ? 'N disfraces' : 'Muy pronto' }))
  return waList('¿Para quién es el disfraz? 🎭', 'Ver públicos', rows, 'Públicos')
}

// --- validación de límites (espejo de validateInteractive) ---
function violations(m) {
  const v = []
  const it = m.interactive
  if (!it?.body?.text?.trim()) v.push('body.text vacío')
  if (it?.type === 'button') {
    const bs = it.action.buttons
    if (bs.length > 3) v.push(`${bs.length} botones >3`)
    bs.forEach((b, i) => { if (len(b.reply.title) > 20) v.push(`botón ${i} título ${len(b.reply.title)}>20`) })
  }
  else if (it?.type === 'list') {
    const rows = it.action.sections.flatMap(s => s.rows)
    if (rows.length > 10) v.push(`${rows.length} filas >10`)
    if (len(it.action.button) > 20) v.push(`label lista ${len(it.action.button)}>20`)
    const ids = new Set()
    rows.forEach((r) => {
      if (len(r.title) > 24) v.push(`fila "${r.title}" ${len(r.title)}>24`)
      if (r.description && len(r.description) > 72) v.push(`fila "${r.title}" desc >72`)
      if (ids.has(r.id)) v.push(`id duplicado ${r.id}`)
      ids.add(r.id)
    })
  }
  return v
}

const message = which === 'lista' ? publicosList() : mainMenu()
console.log(`\n== Payload (${which}) ==`)
console.log(JSON.stringify(message, null, 2))
const vio = violations(message)
console.log(`\n== Violaciones de límites: ${vio.length ? vio.join('; ') : 'ninguna'} ==`)

console.log(`\n== Enviando a ${to} vía phone_id ${PHONE_ID} ==`)
const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_ID}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
})
const json = await res.json().catch(() => ({}))
console.log(`HTTP ${res.status}`)
console.log(JSON.stringify(json, null, 2))
if (json?.messages?.[0]?.id) {
  console.log(`\n✅ Graph aceptó — wamid: ${json.messages[0].id}`)
  console.log('   OJO: aceptado ≠ entregado. Si NO llega al teléfono, mira los logs')
  console.log('   del webhook: el status "failed" traerá el código real del fallo.')
}
else {
  console.log('\n❌ Graph rechazó el envío (ver "error" arriba: code/message).')
}
process.exit(json?.messages?.[0]?.id ? 0 : 2)
