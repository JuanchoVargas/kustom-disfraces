import type { Product, ProductGama } from '../types/woo'
import type { ProductoCatalogo } from '../types/catalogo'

/**
 * Reconstruye la forma legacy `Product[]` (la que consumen Home/PLP/PDP/carrito)
 * desde el catálogo oficial. Las parejas super+economico (`parejaDe`) vuelven a
 * ser UN producto con dos gamas, idéntico al modelo anterior — la UI no cambia.
 */

const PUBLICO_A_CATEGORIA: Record<string, string> = {
  bebes: 'bebes',
  ninos: 'ninos',
  ninas: 'ninas',
  damas: 'adultos',
  caballeros: 'adultos',
}

const GAMA_META = {
  super: { label: 'Súper Acolchado', color: 'var(--purple)' },
  economico: { label: 'Línea Eco', color: 'var(--turq)' },
} as const

const toGama = (item: ProductoCatalogo): ProductGama => {
  const meta = GAMA_META[item.grupo as keyof typeof GAMA_META]
  return {
    label: meta.label,
    color: meta.color,
    description: item.descripcionGama,
    price: item.precio ?? undefined,
    code: item.codigo,
    sizes: item.tallas,
    image: item.imagenes[0],
  }
}

export const catalogoToProducts = (catalogo: ProductoCatalogo[]): Product[] => {
  const visibles = catalogo.filter(i => i.disponibleWeb)
  const ecoDe = new Map(visibles.filter(i => i.parejaDe).map(i => [i.parejaDe as string, i]))

  return visibles
    .filter(i => !i.parejaDe) // los eco emparejados se re-unen a su super
    .map((item) => {
      const categorySlugs = [...new Set(item.publicos.map(p => PUBLICO_A_CATEGORIA[p] as string))]
      const eco = ecoDe.get(item.codigo)

      // super/economico llevan selector de gama (aunque exista una sola)
      let gamas: ProductGama[] | undefined
      if (item.grupo === 'super' || item.grupo === 'economico') {
        gamas = [toGama(item)]
        if (eco) gamas.push(toGama(eco))
      }

      const product: Product = {
        id: item.idWeb as number,
        name: item.nombre,
        slug: item.slug as string,
        code: item.codigo,
        price: item.precio as number,
        sizes: item.tallas,
        includes: item.incluye,
        images: item.imagenes,
        categorySlug: categorySlugs[0] as string,
        categorySlugs,
        description: item.descripcion,
        season: item.temporada,
        publicos: item.publicos,
        subcategoriasNav: [...new Set([item.subcategoriaNav, eco?.subcategoriaNav ?? null]
          .filter((s): s is string => s !== null))],
      }
      if (gamas) product.gamas = gamas
      if (item.destacado) product.featured = true
      return product
    })
    .sort((a, b) => a.id - b.id)
}
