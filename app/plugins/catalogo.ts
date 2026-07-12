import type { ProductoCatalogo } from '~~/shared/types/catalogo'

/**
 * Origen de datos del catálogo (Fase D). Con DATA_SOURCE=woo, el catálogo se
 * trae del proxy /api/products durante el SSR y viaja al cliente en el
 * payload de hidratación (useState) — useProducts sigue siendo síncrono y la
 * UI no cambia. Con DATA_SOURCE=local (default) este plugin no hace nada y
 * todo sale del catalogo.json empaquetado.
 *
 * Si el proxy falla, el estado queda null y useProducts sirve el catálogo
 * local: el sitio nunca se cae por culpa de la API.
 */
export default defineNuxtPlugin(async () => {
  const { dataSource } = useRuntimeConfig().public
  if (dataSource !== 'woo') return

  const remoto = useState<ProductoCatalogo[] | null>('catalogo-remoto', () => null)
  if (import.meta.server && !remoto.value) {
    try {
      remoto.value = await $fetch<ProductoCatalogo[]>('/api/products')
    } catch (err) {
      console.error('[catalogo] DATA_SOURCE=woo pero el proxy falló; se sirve el catálogo local.', err)
    }
  }
})
