// Pruebas de la ATRIBUCIÓN del panel (NUXT_PANEL_AUTORES). Sin red, sin BD.
//
//   node scripts/test-autor-panel.mjs
//
// Lo que fija: solo se estampan nombres de la lista, el resto queda en null
// (mejor sin firmar que firmado de cualquier manera), y nunca bloquea.
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let LISTA = 'Lesly,Jaime,Juan Diego'
globalThis.useRuntimeConfig = () => ({ panelAutores: LISTA, public: {} })

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const { panelAutores, autorValido } = await jiti.import('../server/utils/panelAutores.ts')

let fails = 0
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fails++
}

check('la lista se parte por comas', panelAutores().join('|') === 'Lesly|Jaime|Juan Diego', panelAutores().join('|'))
LISTA = ' Lesly , Jaime '
check('se recortan espacios y se ignoran vacíos', panelAutores().join('|') === 'Lesly|Jaime', panelAutores().join('|'))
LISTA = 'Lesly,Jaime,Juan Diego'

check('un nombre de la lista se acepta', autorValido('Jaime') === 'Jaime')
check('un nombre con espacios sobrantes se acepta', autorValido('  Jaime  ') === 'Jaime')
check('se normaliza a como está en la lista', autorValido('lesly') === 'Lesly', autorValido('lesly'))
check('un nombre con espacio interno se acepta', autorValido('Juan Diego') === 'Juan Diego')
check('un nombre que NO está en la lista se descarta', autorValido('Pepito') === undefined)
check('vacío se descarta', autorValido('') === undefined)
check('no-string se descarta', autorValido(123) === undefined && autorValido(null) === undefined && autorValido(undefined) === undefined)

LISTA = ''
check('sin lista configurada no se firma nada (nunca bloquea)', autorValido('Lesly') === undefined && panelAutores().length === 0)

console.log(fails ? `\n❌ ${fails} comprobación(es) fallida(s)` : '\n✅ todo correcto')
process.exit(fails ? 1 : 0)
