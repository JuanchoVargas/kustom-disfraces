// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/image',
    '@nuxt/fonts',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@vueuse/motion/nuxt',
  ],

  // Nombres de componente = nombre de archivo (sin prefijo de carpeta).
  // ui/KButton.vue -> <KButton>, product/ProductCard.vue -> <ProductCard>.
  components: [
    { path: '~/components', pathPrefix: false },
  ],

  // Design system global (tokens.css es la fuente de verdad del diseño)
  css: [
    '~/assets/css/tokens.css',
    '~/assets/css/main.css',
  ],

  // PROVISIONAL: la antigua categoría "adultos" se dividió en damas/caballeros
  // (nueva taxonomía). Se redirige al público con más catálogo hoy (damas);
  // revisar cuando caballeros tenga más productos o exista página puente.
  routeRules: {
    '/categoria/adultos': { redirect: { to: '/categoria/damas', statusCode: 301 } },
  },

  // Transición de página global (fade corto). CSS en main.css.
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      // Sitio indexable (precios y contenido ya definitivos). El noindex global
      // se retiró; solo /carrito y /mayoristas (y páginas internas) llevan
      // noindex por página. robots.txt + /sitemap.xml guían a Google.
      // Favicon = isotipo K/alien (blanco sobre morado de marca), legible a 16-32px.
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },

  // Auto-hospeda solo las fuentes que NO son de sistema.
  // Bahnschrift es fuente de Windows -> no se descarga; queda como 1ra opción
  // en la cadena font-family definida en tokens.css.
  fonts: {
    families: [
      { name: 'Luckiest Guy', provider: 'google', weights: [400] },
      { name: 'Barlow Semi Condensed', provider: 'google', weights: [400, 500, 600, 700] },
    ],
    // Las fuentes se referencian vía var(--ff-display/--ff-body). Sin esto,
    // el escaner de @nuxt/fonts no las "ve" dentro de las variables CSS y no
    // inyecta los @font-face. processCSSVariables resuelve esos nombres.
    experimental: {
      processCSSVariables: true,
    },
  },

  // Seguridad dia 1 (regla #1): claves de WooCommerce SOLO en servidor.
  // Sin la rama "public" => nunca se serializan al cliente. Los defaults
  // salen del .env en build (nuxi lo carga solo); en runtime se pueden
  // sobreescribir con las variables NUXT_* equivalentes.
  runtimeConfig: {
    wooBaseUrl: process.env.WOO_API_URL || '',              // -> NUXT_WOO_BASE_URL
    wooConsumerKey: process.env.WOO_CONSUMER_KEY || '',     // -> NUXT_WOO_CONSUMER_KEY
    wooConsumerSecret: process.env.WOO_CONSUMER_SECRET || '', // -> NUXT_WOO_CONSUMER_SECRET
    // SMTP para el formulario de mayoristas (solo servidor; nunca al cliente).
    // Defaults del .env en build; en runtime se sobrescriben con NUXT_SMTP_*.
    // Sin credenciales configuradas, /api/mayoristas responde 503 "not_configured".
    smtpHost: process.env.SMTP_HOST || '',                  // -> NUXT_SMTP_HOST (ej: smtp.hostinger.com)
    smtpPort: process.env.SMTP_PORT || '465',               // -> NUXT_SMTP_PORT (465 SSL / 587 STARTTLS)
    smtpUser: process.env.SMTP_USER || '',                  // -> NUXT_SMTP_USER (contacto@disfraceskustom.com)
    smtpPass: process.env.SMTP_PASS || '',                  // -> NUXT_SMTP_PASS (clave del buzón)
    smtpFrom: process.env.SMTP_FROM || '',                  // -> NUXT_SMTP_FROM (remitente; por defecto = smtpUser)
    mayoristasTo: process.env.MAYORISTAS_TO || 'contacto@disfraceskustom.com', // -> NUXT_MAYORISTAS_TO
    public: {
      // Origen del catálogo: 'local' (catalogo.json) | 'woo' (proxy /api/products).
      // Default LOCAL — el switch a woo se hace tras verificar paridad (README).
      dataSource: process.env.DATA_SOURCE || 'local',       // -> NUXT_PUBLIC_DATA_SOURCE
      // URL canónica del sitio (sitemap, robots, JSON-LD, canonicals).
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://www.disfraceskustom.com',
    },
  },
})
