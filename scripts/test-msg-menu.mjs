// Previsualiza SIN RED el bot de Messenger/IG (cerebro de canal + adaptador de
// salida), con memoria de slots hilada entre turnos, como lo haría el webhook.
//   node scripts/test-msg-menu.mjs            (conversación real de los pantallazos + casos sueltos)
//   node scripts/test-msg-menu.mjs "<texto>"  (un texto libre puntual, estado nuevo)
//
// Carga la lógica real (whatsappBot + messengerBot + messenger) vía jiti, sin red.
import { fileURLToPath } from 'node:url'

const { createJiti } = await import('jiti')
const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({ public: { siteUrl: 'https://www.disfraceskustom.com' }, messengerPageToken: '' })
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const mbot = await jiti.import(fileURLToPath(new URL('../server/utils/messengerBot.ts', import.meta.url)))
const msgr = await jiti.import(fileURLToPath(new URL('../server/utils/messenger.ts', import.meta.url)))

const fresh = () => ({ step: 'start', flaggedForHuman: false, updatedAt: 0 })

// Un turno: réplica exacta de lo que hace messenger.post (cerebro de canal →
// adaptador de salida → guarda patch + lastMenu). Devuelve los mensajes de Messenger.
function turn(state, userInput) {
  const input = typeof userInput === 'string'
    ? { from: 'u', kind: 'text', text: userInput }
    : { from: 'u', kind: 'reply', replyId: userInput.replyId }
  const { replies, patch } = mbot.buildMessengerReplies(input, state)
  const { messages, lastMenu } = msgr.toMessengerReplies(replies)
  return { messages, newState: { ...state, ...patch, updatedAt: 0, lastMenu } }
}

function printMessages(messages) {
  for (const m of messages) {
    console.log('\n  [bot]')
    console.log(m.text.split('\n').map(l => `    ${l}`).join('\n'))
    if (m.quick_replies?.length) {
      console.log('    ' + m.quick_replies.map(q => `( ${q.title} )`).join('  '))
    }
  }
}

function convo(title, inputs) {
  console.log(`\n\n════════════════ ${title} ════════════════`)
  let state = fresh()
  for (const inp of inputs) {
    const label = typeof inp === 'string' ? inp : `[tap ${inp.replyId}]`
    console.log(`\n🧑 «${label}»`)
    const { messages, newState } = turn(state, inp)
    printMessages(messages)
    state = newState
    const s = state.slots
    if (s) console.log(`     · slots → producto:${s.producto ?? '—'} talla:${s.talla ?? '—'} publico:${s.publico ?? '—'}`)
  }
}

// Caso puntual por argumento.
if (process.argv[2]) {
  const { messages } = turn(fresh(), process.argv[2])
  console.log(`🧑 «${process.argv[2]}»`)
  printMessages(messages)
  process.exit(0)
}

// Secuencia REAL de los pantallazos (memoria de slots entre turnos).
convo('SECUENCIA REAL (slots vivos entre turnos)', [
  'Hola buenas tardes',
  'Q precio tiene los trajes de niños',
  'Super man',
  'Q piecio tiene',
  'Y hombra arañas',
])

// Casos sueltos (cada uno con estado nuevo).
convo('SALUDO SUELTO', ['buenas noches'])
convo('BÚSQUEDA CON TALLA', ['tienes el de astronauta talla 10'])
convo('SIN RESULTADOS', ['diosa griega'])
