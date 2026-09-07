import type { Product } from '../types/woo'
import type { ProductoCatalogo } from '../types/catalogo'

/**
 * Proyecta el catálogo oficial a la forma `Product` que consumen las vistas.
 * Súper y Línea Entrada son productos SEPARADOS (decisión del cliente): cada
 * ítem visible es su propia card/PDP con su precio y tallas. `parejaDe` ya no
 * re-une nada — solo alimenta el enlace cruzado discreto de la PDP
 * ("¿Buscas la versión económica?" ↔ acabado premium).
 */
/**
 * Imágenes que muestra la web para un ítem. Con `source === 'woo'` usa las de
 * WooCommerce y cae a las locales si el producto no tiene ninguna en Woo; con
 * 'local' (default) siempre las del repo. El respaldo local es permanente.
 */
export const imagenesPara = (item: ProductoCatalogo, source: 'local' | 'woo'): string[] =>
  (source === 'woo' && item.imagenesWoo?.length ? item.imagenesWoo : item.imagenes)

export const catalogoToProducts = (catalogo: ProductoCatalogo[], imagesSource: 'local' | 'woo' = 'local'): Product[] => {
  const visibles = catalogo.filter(i => i.disponibleWeb)
  const byCodigo = new Map(visibles.map(i => [i.codigo, i]))
  const ecoDeSuper = new Map(visibles.filter(i => i.parejaDe).map(i => [i.parejaDe as string, i]))

  return visibles
    .map((item) => {
      // pareja del enlace cruzado: el eco apunta a su super y viceversa
      const pareja = item.parejaDe ? byCodigo.get(item.parejaDe) : ecoDeSuper.get(item.codigo)

      const product: Product = {
        id: item.idWeb as number,
        name: item.nombre,
        slug: item.slug as string,
        code: item.codigo,
        price: item.precio as number,
        sizes: item.tallas,
        includes: item.incluye,
        images: imagenesPara(item, imagesSource),
        // Respaldo por imagen: si una URL de Woo falla al cargar, el componente
        // puede caer a la local equivalente (misma posición) sin recargar.
        imagesFallback: imagesSource === 'woo' && item.imagenesWoo?.length ? item.imagenes : undefined,
        categorySlug: item.publicos[0] as string,
        categorySlugs: item.publicos,
        description: item.descripcion,
        season: item.temporada,
        publicos: item.publicos,
        subcategoriasNav: item.subcategoriaNav ? [item.subcategoriaNav] : [],
        grupo: item.grupo,
      }
      if (item.destacado) product.featured = true
      if (item.fotoIndividual) product.fotoIndividual = true
      if (pareja) {
        product.pareja = {
          slug: pareja.slug as string,
          name: pareja.nombre,
          // tipo de la PAREJA enlazada (no del producto actual)
          tipo: item.parejaDe ? 'super' : 'economico',
        }
      }
      return product
    })
    .sort((a, b) => a.id - b.id)
}
