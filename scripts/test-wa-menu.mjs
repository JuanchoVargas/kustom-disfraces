// Reproduce SIN DEPLOY el menú/búsqueda del bot. Dos modos:
//
//   node scripts/test-wa-menu.mjs buscar "<consulta>"      (LOCAL, sin red)
//     → previsualiza la respuesta EXACTA del bot a un texto libre, tal como
//       saldría con el flag force-text activo (menú/ficha/lista numerados).
//       Carga la lógica real (server/utils/*.ts) vía jiti, sin duplicarla.
//
//   node scripts/test-wa-menu.mjs <numero_destino> [menu|lista]   (ENVÍA por Graph)
//     menu  (default) → menú de bienvenida (interactive.type=button)
//     lista           → lista de públicos (interactive.type=list)
//     Lee NUXT_WHATSAPP_TOKEN y NUXT_WHATSAPP_PHONE_ID de .env. El <numero> va en
//     formato internacional sin '+'. Usa SIEMPRE el número de prueba registrado
//     573154168607 — NUNCA 573118844547, que es la línea real del negocio.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const GRAPH_VERSION = 'v21.0'

// ---------- modo LOCAL: previsualizar la respuesta del bot a un texto ----------
if (process.argv[2] === 'buscar') {
  const query = process.argv[3]
  if (!query) { console.error('Uso: node scripts/test-wa-menu.mjs buscar "<consulta>"'); process.exit(1) }
  await previewSearch(query)
  process.exit(0)
}

// ---------- modo LOCAL: menú de bienvenida + elegir una opción ----------
// node scripts/test-wa-menu.mjs menu-preview [nº]   (default 4 = Ver catálogo)
if (process.argv[2] === 'menu-preview') {
  await previewMenu(process.argv[3] ?? '4')
  process.exit(0)
}

// ---------- modo LOCAL: demo de navegación atrás ----------
if (process.argv[2] === 'nav-preview') {
  await previewNav()
  process.exit(0)
}

const to = process.argv[2]
const which = (process.argv[3] ?? 'menu').toLowerCase()
if (!to) {
  console.error('Falta el número destino.\nUso: node scripts/test-wa-menu.mjs <numero> [menu|lista]  |  buscar "<consulta>"')
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
  // Espejo del bot: lista de 4 opciones (no botones, que topan en 3).
  return waList(
    '¡Hola! 👋 Soy el asistente de *Kustom Disfraces* 👽\n¿Qué quieres hacer?',
    'Ver opciones',
    [
      { id: 'main:ver', title: 'Ver disfraces' },
      { id: 'main:como', title: 'Cómo comprar' },
      { id: 'main:human', title: 'Hablar con alguien' },
      { id: 'main:catalogo', title: 'Ver catálogo 📖' },
    ],
    'Menú',
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

// ---------- preview local del bot (usa la lógica real vía jiti) ----------
// Carga el bot real y devuelve un `turn(text, state)` que rinde cada respuesta
// TAL COMO llega hoy al cliente (force-text: interactivo → texto numerado).
async function makeBot() {
  const { createJiti } = await import('jiti')
  const root = fileURLToPath(new URL('..', import.meta.url))
  globalThis.useRuntimeConfig = () => ({
    public: { siteUrl: 'https://www.disfraceskustom.com' },
    whatsappForceTextMenu: true,
  })
  const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
  const bot = await jiti.import(fileURLToPath(new URL('../server/utils/whatsappBot.ts', import.meta.url)))
  const wa = await jiti.import(fileURLToPath(new URL('../server/utils/whatsapp.ts', import.meta.url)))

  const render = (msg) => {
    if (msg.type === 'interactive') {
      const fb = wa.waNumberedFallback(msg)
      return fb ? { text: fb.message.text.body, ids: fb.ids } : { text: JSON.stringify(msg), ids: [] }
    }
    return { text: msg.text.body, ids: [] }
  }
  // input: string (texto libre / número) u objeto { replyId } (tap de botón/fila).
  const turn = (input, state) => {
    const incoming = typeof input === 'string'
      ? { from: 'preview', kind: 'text', text: input }
      : { from: 'preview', kind: 'reply', replyId: input.replyId }
    const { replies, patch } = bot.buildBotReplies(incoming, state)
    let lastMenu
    const out = replies.map((m) => { const r = render(m); if (r.ids.length) lastMenu = r.ids; return r.text })
    return { out, newState: { ...state, ...patch, updatedAt: 0, lastMenu } }
  }
  return { turn }
}

async function previewSearch(query) {
  const { turn } = await makeBot()
  console.log(`\n════════ consulta: "${query}" ════════`)
  const state = { step: 'start', flaggedForHuman: false, updatedAt: 0 }
  const t1 = turn(query, state)
  t1.out.forEach(t => console.log(`\n[bot]\n${t}`))
  if (t1.newState.lastMenu?.length) {
    console.log('\n──── (el usuario responde "1") ────')
    turn('1', t1.newState).out.forEach(t => console.log(`\n[bot]\n${t}`))
  }
}

// Menú de bienvenida (un saludo lo dispara) + el usuario elige la opción `num`.
async function previewMenu(num) {
  const { turn } = await makeBot()
  console.log(`\n════════ menú de bienvenida → opción ${num} ════════`)
  const state = { step: 'start', flaggedForHuman: false, updatedAt: 0 }
  const t1 = turn('hola', state)
  t1.out.forEach(t => console.log(`\n[bot]\n${t}`))
  console.log(`\n──── (el usuario responde "${num}") ────`)
  turn(String(num), t1.newState).out.forEach(t => console.log(`\n[bot]\n${t}`))
}

// Demo de navegación ATRÁS: baja hasta subLink (categoría → público → sub) y
// regresa nivel por nivel con "0", "volver" y el tap de la fila ⬅️ Volver.
async function previewNav() {
  const { turn } = await makeBot()
  let st = { step: 'start', flaggedForHuman: false, updatedAt: 0 }
  const show = (label, input) => {
    console.log(`\n──── ${label} ────`)
    const r = turn(input, st)
    r.out.forEach(t => console.log(`\n[bot]\n${t}`))
    st = r.newState
    return r
  }
  // Elige un id del último menú que cumpla el predicado (o el primero que empiece por prefijo).
  const pick = (pred) => (st.lastMenu ?? []).find(pred)

  console.log('\n════════ navegación ATRÁS (Trusas → Damas → públicos → menú) ════════')
  show('saludo → menú principal', 'hola')
  show('tap "Ver disfraces"', { replyId: 'main:ver' })
  const pubId = pick(id => id === 'pub:damas') ?? pick(id => id.startsWith('pub:'))
  show(`tap público (${pubId})`, { replyId: pubId })
  const subId = pick(id => id.endsWith(':trusas')) ?? pick(id => id.startsWith('sub:'))
  show(`tap subcategoría (${subId})`, { replyId: subId })
  show('escribe "0"  → vuelve a subcategorías (Damas)', '0')
  show('escribe "volver" → vuelve a públicos', 'volver')
  show('tap ⬅️ Volver (id back) → vuelve al menú principal', { replyId: 'back' })

  console.log('\n════════ "menú" REINICIA la pila desde el fondo ════════')
  show('tap "Ver disfraces"', { replyId: 'main:ver' })
  show(`tap público (${pubId})`, { replyId: pubId })
  show('escribe "menú" → reinicia (pila vacía, sin Volver)', 'menú')
}
