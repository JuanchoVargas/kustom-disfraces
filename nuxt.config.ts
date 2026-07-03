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

  // Transición de página global (fade corto). CSS en main.css.
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
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
  // Sin la rama "public" => nunca se serializan al cliente. Se inyectan por
  // variables de entorno en runtime (ver nombres NUXT_* a la derecha).
  runtimeConfig: {
    wooBaseUrl: '',        // -> NUXT_WOO_BASE_URL
    wooConsumerKey: '',    // -> NUXT_WOO_CONSUMER_KEY
    wooConsumerSecret: '', // -> NUXT_WOO_CONSUMER_SECRET
  },
})
