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
  // Públicos de la taxonomía oficial, en el ORDEN canónico del navbar
  // (Combos aparecerá cuando tenga productos)
  const categories: NavLink[] = [
    { label: 'Bebés', slug: 'bebes' },
    { label: 'Niños', slug: 'ninos' },
    { label: 'Niñas', slug: 'ninas' },
    { label: 'Damas', slug: 'damas' },
    { label: 'Caballeros', slug: 'caballeros' },
  ]

  const info: { label: string, to: string }[] = [
    { label: 'Sobre nosotros', to: '/sobre-nosotros' },
    { label: 'Cómo comprar', to: '/como-comprar' },
    { label: 'Envíos y entregas', to: '/envios' },
    { label: 'Cambios', to: '/devoluciones' }, // ruta /devoluciones intacta; solo cambia el nombre visible
    { label: 'Preguntas frecuentes', to: '/faq' },
    { label: 'Ventas al por mayor', to: '/mayoristas' },
    { label: 'Política de tratamiento de datos', to: '/politica-datos' },
  ]

  // Contacto oficial
  const contact = {
    email: 'contacto@disfraceskustom.com',
    phone: '3144477210', // teléfono de contacto (tel: en el footer)
    city: 'Bogotá, Colombia',
    hours: 'Lunes a sábado, 8:00 a.m. a 7:00 p.m.',
    whatsapp: 'https://wa.me/573144477210', // WhatsApp oficial Kustom
  }

  return { categories, info, contact }
}
