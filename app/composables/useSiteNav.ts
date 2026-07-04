/**
 * Navegación del sitio (categorías + enlaces de información).
 * Datos dummy temporales — en Fase D vendrán de WooCommerce.
 * Compartido entre AppNavbar y AppFooter para no duplicar.
 */
export interface NavLink {
  label: string
  slug: string
}

export const useSiteNav = () => {
  const categories: NavLink[] = [
    { label: 'Niños', slug: 'ninos' },
    { label: 'Niñas', slug: 'ninas' },
    { label: 'Adultos', slug: 'adultos' },
    { label: 'Bebés', slug: 'bebes' },
  ]

  const info: { label: string, to: string }[] = [
    { label: 'Sobre nosotros', to: '/sobre-nosotros' },
    { label: 'Cómo comprar', to: '/como-comprar' },
    { label: 'Envíos y entregas', to: '/envios' },
    { label: 'Cambios y devoluciones', to: '/devoluciones' },
    { label: 'Preguntas frecuentes', to: '/faq' },
  ]

  // Contacto oficial
  const contact = {
    email: 'hola@disfraceskustom.com',
    city: 'Bogotá, Colombia',
    whatsapp: 'https://wa.me/573000000000', // placeholder hasta tener el número real
  }

  return { categories, info, contact }
}
