// Pruebas del OVERRIDE DE AGOTADOS (NUXT_SKUS_AGOTADOS). Sin red, sin BD, sin escribir.
//
//   node scripts/test-agotados-override.mjs
//
// Lo que fija esta prueba:
//   · el formato del valor: coma entre entradas, ":" para el motivo, "-T" = talla
//   · REGRESIÓN: un motivo con coma parte la entrada y el trozo sobrante NO puede
//     agotar un código fantasma en silencio; tiene que salir reportado
//   · un SKU real que el snapshot todavía no trajo SÍ se aplica (no es un error)
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let SKUS = ''
globalThis.useRuntimeConfig = () => ({ skusAgotados: SKUS, inventoryStockBajo: 5, public: {} })

const { createJiti } = await import('jiti')
const jiti = createJiti(import.meta.url, { alias: { '~~': root, '~': root, '@@': root, '@': root } })
const { computeStockState, validarForzados, sugerenciaSkusAgotados } = await jiti.import('../server/utils/stockState.ts')

let fails = 0
const check = (nombre, ok, detalle = '') => {
  console.log(`${ok ? '✅' : '❌'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fails++
}

// Inventario de prueba: Pollito completo. Cerdito existe en catalogo.json pero
// NO se pasa aquí, para comprobar que un snapshot incompleto no lo invalida.
const variacion = (codigo, talla) => ({
  sku: `${codigo}-T${talla}`, manage_stock: false, stock_quantity: null,
  stock_status: 'instock', attributes: [{ name: 'Talla', option: String(talla) }],
})
const PRODUCTOS = [{
  sku: '001011001', name: 'Pollito', status: 'publish',
  variations: ['Bebé', 0, 2, 4].map(t => variacion('001011001', t)),
}]

const estado = (valor) => { SKUS = valor; return computeStockState(PRODUCTOS, false, 'mock') }
const validar = (valor) => { SKUS = valor; return validarForzados(PRODUCTOS) }

// ---------- formato ----------
{
  const v = validar('001011001,001011004:dato faltante - falta cargar stock')
  check('la coma separa entradas', v.productos.size === 2, [...v.productos].join(' + '))
  check('el motivo con espacios y guion llega entero',
    v.motivos.get('001011004') === 'dato faltante - falta cargar stock', v.motivos.get('001011004'))
  check('se mezclan entradas con y sin motivo', !v.motivos.has('001011001') && v.motivos.has('001011004'))
  check('sin SKU inválidos', v.noEncontrados.length === 0, v.noEncontrados.join(' · '))
}
{
  const v = validar('001011001-T4')
  check('"-T" marca talla, no producto', v.variaciones.has('001011001-T4') && v.productos.size === 0)
}
{
  const v = validar(' 001011001 : sin  stock ')
  check('se recortan espacios alrededor de la entrada y del motivo',
    v.productos.has('001011001') && v.motivos.get('001011001') === 'sin  stock')
}
{
  const v = validar('001011004:nota: falta la talla 4')
  check('solo parte en el PRIMER ":"', v.motivos.get('001011004') === 'nota: falta la talla 4', v.motivos.get('001011004'))
}

// ---------- REGRESIÓN: motivo con coma ----------
{
  const valor = '001011001:falta stock, pregunta a ventas'
  const v = validar(valor)
  check('motivo con coma → el trozo sobrante se reporta como no encontrado',
    v.noEncontrados.includes('pregunta a ventas'), `noEncontrados=[${v.noEncontrados.join(' · ')}]`)
  check('motivo con coma → el SKU real de la entrada sí se aplica',
    v.productos.has('001011001') && v.productos.size === 1, [...v.productos].join(' + '))

  const st = estado(valor)
  check('motivo con coma → NO se agota ningún código fantasma',
    !st.agotados.has('pregunta a ventas'), `agotados=[${[...st.agotados].join(' · ')}]`)
  check('motivo con coma → el estado lo expone para el panel',
    st.forzadosNoEncontrados.includes('pregunta a ventas'))
  check('motivo con coma → el producto real sigue agotado',
    st.agotados.has('001011001'))
}

// ---------- un SKU real ausente del snapshot NO es un error ----------
{
  // Cerdito está en catalogo.json pero no en PRODUCTOS (snapshot incompleto).
  const v = validar('001011002')
  check('SKU real ausente del snapshot: se aplica, no se reporta',
    v.productos.has('001011002') && v.noEncontrados.length === 0, `noEncontrados=[${v.noEncontrados.join(' · ')}]`)
  const st = estado('001011002')
  check('SKU real ausente del snapshot: queda agotado igual', st.agotados.has('001011002'))
  // Y una talla real de un producto que el snapshot no trajo.
  const v2 = validar('001011002-T4')
  check('talla real ausente del snapshot: se aplica', v2.variaciones.has('001011002-T4') && v2.noEncontrados.length === 0)
}

// ---------- dedazos ----------
{
  const v = validar('001011001,00101XXXX,001011001-T99')
  check('código inventado se reporta', v.noEncontrados.includes('00101XXXX'))
  check('talla inexistente de un producto real se reporta', v.noEncontrados.includes('001011001-T99'))
  check('lo válido de la misma lista se sigue aplicando', v.productos.has('001011001'))
}

// ---------- LA GRIETA: publicado sin existencias que la variable no bloquea ----------
{
  const cero = (codigo, talla) => ({ ...variacion(codigo, talla), manage_stock: true, stock_quantity: 0, stock_status: 'outofstock' })
  const agotadoReal = (codigo, nombre, status) => ({ sku: codigo, name: nombre, status, variations: [0, 2, 4].map(t => cero(codigo, t)) })
  const conGrieta = (valor, productos) => { SKUS = valor; return computeStockState(productos, false, 'mock').agotadosSinForzar }

  const wolverine = agotadoReal('001001010', 'Wolverine', 'publish')
  check('publicado sin existencias y fuera de la variable → se reporta',
    conGrieta('', [wolverine]).some(a => a.codigo === '001001010'))
  check('el mismo, ya en la variable → NO se reporta',
    conGrieta('001001010', [wolverine]).length === 0)
  check('el mismo, cubierto talla a talla → NO se reporta',
    conGrieta('001001010-T0,001001010-T2,001001010-T4', [wolverine]).length === 0)
  check('borrador sin existencias → NO se reporta (no se vende)',
    conGrieta('', [agotadoReal('001003001', 'Semi', 'draft')]).length === 0)
  check('publicado con una talla viva → NO se reporta',
    conGrieta('', [{ ...wolverine, variations: [cero('001001010', 0), variacion('001001010', 2)] }]).length === 0)

  SKUS = '001011001:sin stock'
  const st = computeStockState([...PRODUCTOS, wolverine], false, 'mock')
  const s = sugerenciaSkusAgotados(st)
  check('la sugerencia conserva lo que ya había, con su motivo', s.startsWith('001011001:sin stock,'), s)
  check('la sugerencia añade el que falta', s.includes('001001010:'), s)
  check('sin grieta, la sugerencia va vacía',
    sugerenciaSkusAgotados(computeStockState(PRODUCTOS, false, 'mock')) === '')
}

console.log(fails ? `\n❌ ${fails} comprobación(es) fallida(s)` : '\n✅ todo correcto')
process.exit(fails ? 1 : 0)
