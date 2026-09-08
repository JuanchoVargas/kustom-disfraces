/**
 * Head común de las páginas de administración (/admin, /admin/inventario,
 * /admin/chats): noindex, y los meta de PWA para que "Agregar a pantalla de
 * inicio" quede con nombre e ícono decentes ("Kustom Admin", morado de marca,
 * manifest con start_url /admin). Solo en /admin: el sitio público no lleva
 * el manifest ni el nombre de la app.
 */
export function useAdminHead(title: string) {
  useHead({
    title,
    meta: [
      { name: 'robots', content: 'noindex, nofollow' },
      { name: 'apple-mobile-web-app-title', content: 'Kustom Admin' },
      { name: 'application-name', content: 'Kustom Admin' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      { name: 'theme-color', content: '#7E57C2' },
    ],
    link: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', sizes: '192x192', href: '/icon-192.png' },
    ],
  })
}

/** Ícono de globo de chat (mismo trazo que los íconos del footer). */
export const CHAT_ICON_PATH = 'M21 11.5a8.4 8.4 0 0 1-8.5 8.3c-1.4 0-2.8-.3-4-.9L4 20l1.1-4.2A8.4 8.4 0 1 1 21 11.5z'
