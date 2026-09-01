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
    wooConsumerKey: process.env.WOO_CONSUMER_KEY || '',     // -> NUXT_WOO_CONSUMER_KEY (solo LECTURA: catálogo)
    wooConsumerSecret: process.env.WOO_CONSUMER_SECRET || '', // -> NUXT_WOO_CONSUMER_SECRET
    // Llave de WooCommerce con permiso de ESCRITURA — SOLO para crear órdenes al
    // confirmarse un pago (Fase 3). Separada de la de lectura (mínimo privilegio).
    // Misma tienda (WOO_API_URL). Sin ella, el webhook registra el pago pero no crea orden.
    wooOrdersConsumerKey: process.env.WOO_ORDERS_CONSUMER_KEY || '',       // -> NUXT_WOO_ORDERS_CONSUMER_KEY
    wooOrdersConsumerSecret: process.env.WOO_ORDERS_CONSUMER_SECRET || '', // -> NUXT_WOO_ORDERS_CONSUMER_SECRET
    // SMTP para el formulario de mayoristas (solo servidor; nunca al cliente).
    // Defaults del .env en build; en runtime se sobrescriben con NUXT_SMTP_*.
    // Sin credenciales configuradas, /api/mayoristas responde 503 "not_configured".
    smtpHost: process.env.SMTP_HOST || '',                  // -> NUXT_SMTP_HOST (ej: smtp.hostinger.com)
    smtpPort: process.env.SMTP_PORT || '465',               // -> NUXT_SMTP_PORT (465 SSL / 587 STARTTLS)
    smtpUser: process.env.SMTP_USER || '',                  // -> NUXT_SMTP_USER (contacto@disfraceskustom.com)
    smtpPass: process.env.SMTP_PASS || '',                  // -> NUXT_SMTP_PASS (clave del buzón)
    smtpFrom: process.env.SMTP_FROM || '',                  // -> NUXT_SMTP_FROM (remitente; por defecto = smtpUser)
    mayoristasTo: process.env.MAYORISTAS_TO || 'contacto@disfraceskustom.com', // -> NUXT_MAYORISTAS_TO
    // Buzón principal de PQRS (la copia oculta va a ventasTo). Cambiable sin código.
    pqrsTo: process.env.PQRS_TO || 'contacto@disfraceskustom.com', // -> NUXT_PQRS_TO
    // Buzón de VENTAS: adónde llega el aviso de cada pago aprobado (Fase 4). Distinto
    // del remitente (contacto@) para que no se deduplique. Cambiable sin tocar código.
    ventasTo: process.env.VENTAS_TO || 'ventas@disfraceskustom.com', // -> NUXT_VENTAS_TO
    // Bot de WhatsApp (Cloud API de Meta) — solo servidor. Se leen con prefijo NUXT_
    // para override en runtime (Vercel), la lección del Access Token de MP.
    whatsappToken: process.env.NUXT_WHATSAPP_TOKEN || '',              // -> NUXT_WHATSAPP_TOKEN (token de la app de Meta)
    whatsappPhoneId: process.env.NUXT_WHATSAPP_PHONE_ID || '',         // -> NUXT_WHATSAPP_PHONE_ID (phone number id)
    whatsappVerifyToken: process.env.NUXT_WHATSAPP_VERIFY_TOKEN || '', // -> NUXT_WHATSAPP_VERIFY_TOKEN (verificación del webhook)
    // Kill-switch temporal: fuerza TODOS los menús a texto numerado (sin intentar
    // interactivo). Mientras cazamos por qué Meta acepta y descarta el interactivo.
    // Override en runtime (Vercel) sin redeploy de código.
    whatsappForceTextMenu: process.env.NUXT_WHATSAPP_FORCE_TEXT_MENU === 'true', // -> NUXT_WHATSAPP_FORCE_TEXT_MENU ('true' para forzar texto)
    // Messenger + Instagram (misma app de Meta "kustombot"). Reutilizan el cerebro
    // del bot de WhatsApp vía adaptadores de canal (server/utils/messenger.ts).
    messengerVerifyToken: process.env.NUXT_MESSENGER_VERIFY_TOKEN || '', // -> NUXT_MESSENGER_VERIFY_TOKEN (verificación del webhook GET)
    messengerPageToken: process.env.NUXT_MESSENGER_PAGE_TOKEN || '',     // -> NUXT_MESSENGER_PAGE_TOKEN (Page Access Token para enviar)
    // Mercado Pago (Fase 1: PRUEBA/sandbox). El Access Token es SECRETO y vive
    // SOLO en servidor (crea la preferencia de pago). Sin él, /api/checkout/mercadopago
    // responde 503 "not_configured" y el sitio sigue funcionando (queda WhatsApp).
    mpAccessToken: process.env.MP_ACCESS_TOKEN || '',       // -> NUXT_MP_ACCESS_TOKEN (TEST-... en Fase 1)
    // Secreto de firma del webhook de MP (opcional). Si está, /api/webhooks/mercadopago
    // valida la cabecera x-signature (HMAC) y rechaza notificaciones no auténticas.
    // Sin él, el webhook igual verifica el pago consultando la API de MP.
    mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',    // -> NUXT_MP_WEBHOOK_SECRET
    // Bandeja de atención humana (/admin/chats): contraseña única, solo servidor.
    // La cookie de sesión se firma con una clave derivada de ella. Sin valor, la
    // bandeja responde 503. Postgres se lee directo de POSTGRES_URL (Neon↔Vercel).
    inboxPassword: process.env.NUXT_INBOX_PASSWORD || '',    // -> NUXT_INBOX_PASSWORD
    // Alerta por WhatsApp al encargado cuando un cliente pide atención humana
    // (plantilla aprobada en Meta). Sin destino no se envía; el correo es el respaldo.
    alertWhatsappTo: process.env.NUXT_ALERT_WHATSAPP_TO || '',                       // -> NUXT_ALERT_WHATSAPP_TO
    alertTemplateName: process.env.NUXT_ALERT_TEMPLATE_NAME || 'alerta_atencion',    // -> NUXT_ALERT_TEMPLATE_NAME
    public: {
      // Origen del catálogo: 'local' (catalogo.json) | 'woo' (proxy /api/products).
      // Default LOCAL — el switch a woo se hace tras verificar paridad (README).
      dataSource: process.env.DATA_SOURCE || 'local',       // -> NUXT_PUBLIC_DATA_SOURCE
      // URL canónica del sitio (sitemap, robots, JSON-LD, canonicals).
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://www.disfraceskustom.com',
      // Mercado Pago — Public Key de PRUEBA (frontend). El flujo actual es redirect
      // a la preferencia (Checkout Pro), que NO la necesita; queda registrada y lista
      // para un futuro brick embebido del SDK de MP. Es pública por diseño (no secreta).
      mpPublicKey: process.env.MP_PUBLIC_KEY || '',         // -> NUXT_PUBLIC_MP_PUBLIC_KEY (TEST-... en Fase 1)
      // Precio tachado (gancho de oferta): solo VISUAL, no toca el precio real que
      // se cobra ni la validación server-side (pricing.ts). Encendido por defecto —
      // se apaga sin deploy con NUXT_PUBLIC_SHOW_DISCOUNT=false en Vercel.
      showDiscount: (process.env.NUXT_PUBLIC_SHOW_DISCOUNT ?? 'true') === 'true', // -> NUXT_PUBLIC_SHOW_DISCOUNT
      fakeDiscountPct: Number(process.env.NUXT_PUBLIC_FAKE_DISCOUNT_PCT) || 20,   // -> NUXT_PUBLIC_FAKE_DISCOUNT_PCT
    },
  },
})
