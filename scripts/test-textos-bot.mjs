// Verifica SIN RED los textos del bot pedidos por el cliente, tal como saldrían en
// cada canal, y revisa los límites de longitud de etiquetas de Meta.
//
//   node scripts/test-textos-bot.mjs
//   NUXT_BOT_TEXTO_PROMOCION="" node scripts/test-textos-bot.mjs   (promoción apagada)
//
// Carga la lógica REAL (server/utils/botReplies.ts + whatsapp.ts + messenger.ts)
// vía jiti, con los mismos adaptadores de salida que usan los webhooks:
//   WhatsApp  → toButtonChunks + waNumberedFallback (botones de ≤20, texto sin tope)
//   Messenger → toMessengerReplies (quick replies de ≤20)
import { fileURLToPath } from 'node:url'

const { createJiti } = await import('jiti')
const root = fileURLToPath(new URL('..', import.meta.url))
globalThis.useRuntimeConfig = () => ({
  public: { siteUrl: 'https://www.disfraceskustom.com' },
  messengerPageToken: '',
  botTextoPromocion: process.env.NUXT_BOT_TEXTO_PROMOCION
    ?? 'Recuerda que todos nuestros disfraces tienen 20% de descuento y envío gratis a todo el país.',
})
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })

const { buildReplies } = await jiti.import('../server/utils/botReplies.ts')
const { toButtonChunks, waNumberedFallback, interactiveOptions, validateInteractive } = await jiti.import('../server/utils/whatsapp.ts')
const { toMessengerReplies } = await jiti.import('../server/utils/messenger.ts')

const nuevoEstado = () => ({ step: '', flaggedForHuman: false, updatedAt: Date.now() })
const len = s => [...String(s ?? '')].length

/** Rinde una respuesta como saldría por WhatsApp (botones) y devuelve texto + etiquetas. */
function renderWa(replies) {
  const out = []
  for (const m of replies.flatMap(toButtonChunks)) {
    if (m.type === 'text') { out.push({ texto: m.text.body, etiquetas: [] }); continue }
    const violaciones = validateInteractive(m)
    const opts = interactiveOptions(m) ?? []
    const it = m.interactive
    const etiquetas = it.type === 'button'
      ? it.action.buttons.map(b => b.reply.title)
      : it.action.sections.flatMap(s => s.rows.map(r => r.title))
    out.push({ texto: String(it.body?.text ?? ''), etiquetas, violaciones, tipo: it.type, numerado: waNumberedFallback(m)?.message.text.body })
    void opts
  }
  return out
}
function renderMsg(replies) {
  const { messages } = toMessengerReplies(replies)
  return messages.map(m => ({ texto: m.text, etiquetas: (m.quick_replies ?? []).map(q => q.title) }))
}

const CASOS = [
  ['2.1 BIENVENIDA', { kind: 'text', text: 'hola' }],
  ['2.2 OPCIÓN ASESOR (respuesta)', { kind: 'reply', replyId: 'main:human' }],
  ['2.3 SIN COINCIDENCIAS', { kind: 'text', text: 'disfraz de godzilla mecha' }],
  ['2.4 DIRECCIÓN', { kind: 'text', text: 'donde estan ubicados' }],
  ['2.5 PRECIO EN GENERAL', { kind: 'text', text: 'cuanto cuestan los disfraces' }],
  ['2.6 HORARIO', { kind: 'text', text: 'cual es el horario de atencion' }],
]

let fallos = 0
for (const [titulo, msg] of CASOS) {
  console.log(`\n${'═'.repeat(72)}\n${titulo}\n${'═'.repeat(72)}`)
  for (const canal of ['wa', 'msg']) {
    const input = { from: '570000000088', profileName: 'Juan', canal, ...msg }
    const { replies } = buildReplies(input, nuevoEstado())
    const vistas = canal === 'wa' ? renderWa(replies) : renderMsg(replies)
    console.log(`\n── ${canal === 'wa' ? 'WhatsApp' : 'Messenger / Instagram'} ──`)
    for (const v of vistas) {
      console.log(v.texto.split('\n').map(l => `   ${l}`).join('\n'))
      if (v.etiquetas.length) {
        console.log(`   [opciones] ${v.etiquetas.map(t => `«${t}» (${len(t)})`).join('  ')}`)
        const tope = canal === 'wa' && v.tipo === 'list' ? 24 : 20
        for (const t of v.etiquetas) {
          if (len(t) > tope) { console.log(`   ❌ «${t}» supera ${tope} caracteres`); fallos++ }
          if (/(?:^|\s)\S*…$/.test(t) || /\bun a$/.test(t)) { console.log(`   ❌ «${t}» parece cortada`); fallos++ }
        }
      }
      if (v.violaciones?.length) { console.log(`   ❌ payload inválido: ${v.violaciones.join('; ')}`); fallos++ }
    }
  }
}

// Comprobaciones explícitas de lo que pidió el cliente.
console.log(`\n${'═'.repeat(72)}\nCOMPROBACIONES\n${'═'.repeat(72)}`)
function todoElTexto(canal, msg) {
  const { replies } = buildReplies({ from: '570000000088', profileName: 'Juan', canal, ...msg }, nuevoEstado())
  const vistas = canal === 'wa' ? renderWa(replies) : renderMsg(replies)
  return vistas.map(v => `${v.texto}\n${v.numerado ?? ''}\n${v.etiquetas.join('\n')}`).join('\n')
}
const check = (nombre, ok) => { console.log(`${ok ? '✅' : '❌'} ${nombre}`); if (!ok) fallos++ }

const bienvenidaWa = todoElTexto('wa', { kind: 'text', text: 'hola' })
check('la bienvenida se presenta como Jaime', /soy Jaime, tu asistente virtual/.test(bienvenidaWa))
check('la bienvenida conserva el menú', /Ver disfraces/.test(bienvenidaWa))

// La opción de asesor sale como BOTÓN en WhatsApp (toButtonChunks) y como quick
// reply en Messenger: ambos topan en 20 caracteres, así que se usa la etiqueta
// corta y nunca se corta. La larga solo se ve en el menú numerado de texto
// (kill-switch NUXT_WHATSAPP_FORCE_TEXT_MENU), donde no hay límite.
for (const canal of ['wa', 'msg']) {
  const t = todoElTexto(canal, { kind: 'text', text: 'hola' })
  check(`[${canal}] la opción de asesor sale íntegra como «Hablar con un asesor»`, t.includes('Hablar con un asesor') && !/Hablar con un a$/m.test(t) && !/Comunícate con un a$/m.test(t))
}
const { replies: rawBienvenida } = buildReplies({ from: '570000000088', profileName: 'Juan', canal: 'wa', kind: 'text', text: 'hola' }, nuevoEstado())
const numerado = rawBienvenida.map(m => waNumberedFallback(m)?.message.text.body ?? '').join('\n')
check('en modo texto (force-text) se lee «Comunícate con un asesor» completo', numerado.includes('Comunícate con un asesor'))

for (const canal of ['wa', 'msg']) {
  const dir = todoElTexto(canal, { kind: 'text', text: 'donde estan ubicados' })
  check(`[${canal}] la dirección de la calle NO aparece`, !/Cra 52|39-89|Carrera 52/.test(dir))
  const precio = todoElTexto(canal, { kind: 'text', text: 'cuanto cuestan los disfraces' })
  check(`[${canal}] el rango $69.000–$159.000 NO aparece`, !/69\.000|159\.000/.test(precio))
}
const horaWa = todoElTexto('wa', { kind: 'text', text: 'cual es el horario de atencion' })
const horaMsg = todoElTexto('msg', { kind: 'text', text: 'cual es el horario de atencion' })
check('WhatsApp NO incluye el teléfono en el horario', !/311 884 4547/.test(horaWa))
check('Messenger SÍ incluye el teléfono en el horario', /O llámanos al 311 884 4547\./.test(horaMsg))

const promo = todoElTexto('wa', { kind: 'text', text: 'cuanto cuestan los disfraces' })
const conPromo = /20% de descuento y envío gratis/.test(promo)
const esperada = String(globalThis.useRuntimeConfig().botTextoPromocion ?? '').trim() !== ''
check(`la promoción ${esperada ? 'aparece' : 'está apagada'} según NUXT_BOT_TEXTO_PROMOCION`, conPromo === esperada)

console.log(`\n${fallos ? `❌ ${fallos} fallo(s)` : '✅ todo correcto'}`)
process.exit(fallos ? 1 : 0)
