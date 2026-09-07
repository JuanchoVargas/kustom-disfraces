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

  // NuxtImg (IPX): además de /images/* del propio sitio, se permite el dominio de
  // WordPress para la Fase B (imágenes de Woo optimizadas y cacheadas por el mismo
  // pipeline; sin esto, una URL externa se serviría tal cual, sin optimizar).
  image: {
    domains: ['api.disfraceskustom.com'],
  },

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
    // Llave de ESCRITURA de WooCommerce ("Checkout Orders v2", Read/Write). Las
    // llaves de Woo no distinguen recursos: la misma crea órdenes (checkout) y
    // edita productos (inventario). Nombre nuevo que refleja su uso real:
    wooWriteConsumerKey: process.env.WOO_WRITE_CONSUMER_KEY || '',         // -> NUXT_WOO_WRITE_CONSUMER_KEY
    wooWriteConsumerSecret: process.env.WOO_WRITE_CONSUMER_SECRET || '',   // -> NUXT_WOO_WRITE_CONSUMER_SECRET
    // Nombre ANTERIOR de la misma llave (se sigue leyendo como respaldo para no
    // romper el checkout; ver server/utils/wooWrite.ts). Retirar cuando Vercel
    // tenga las NUXT_WOO_WRITE_* y se haya verificado un pago.
    wooOrdersConsumerKey: process.env.WOO_ORDERS_CONSUMER_KEY || '',       // -> NUXT_WOO_ORDERS_CONSUMER_KEY (legado)
    wooOrdersConsumerSecret: process.env.WOO_ORDERS_CONSUMER_SECRET || '', // -> NUXT_WOO_ORDERS_CONSUMER_SECRET (legado)
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
    // MEDIOS de la bandeja (tabla media, BYTEA en Neon free = 0,5 GB para TODO):
    // retención automática (cron diario /api/cron/keepalive) y tope duro total.
    // Al superar el tope no se guardan más binarios (el mensaje se registra igual).
    mediaRetentionDays: process.env.NUXT_MEDIA_RETENTION_DAYS || '60',   // -> NUXT_MEDIA_RETENTION_DAYS
    mediaMaxTotalMb: process.env.NUXT_MEDIA_MAX_TOTAL_MB || '300',       // -> NUXT_MEDIA_MAX_TOTAL_MB
    // MÓDULO DE INVENTARIO (/admin/inventario): qué adaptador ejecuta las escrituras.
    //   mock (default) = simulación: lee productos reales de Woo (llave de lectura) y
    //                    guarda los cambios en Postgres (inventory_overrides); NO toca Woo.
    //   woo            = escribe de verdad en WooCommerce con la llave de escritura
    //                    (wooOrders*). Cambiar SOLO tras el checklist docs/inventario-activacion.md.
    inventoryBackend: process.env.NUXT_INVENTORY_BACKEND || 'mock', // -> NUXT_INVENTORY_BACKEND (mock | woo)
    // Guarda de validación: mientras sea 'true' el adaptador woo SOLO escribe en
    // productos EN BORRADOR; cualquier escritura a un publicado se rechaza sin
    // tocar Woo. Poner 'false' cuando se validen las operaciones masivas.
    inventoryWooOnlyDrafts: process.env.NUXT_INVENTORY_WOO_ONLY_DRAFTS ?? 'true', // -> NUXT_INVENTORY_WOO_ONLY_DRAFTS (true | false)
    // ¿El stock del adaptador se aplica al SITIO, al BOT y al CHECKOUT? (lógica de
    // agotado: talla en 0 no seleccionable, producto en 0 fuera del catálogo).
    //   auto (default) = solo cuando el adaptador es woo (el mock es simulación).
    //   on  = también con mock (para probar en local / preview).   off = nunca.
    inventoryPublicStock: process.env.NUXT_INVENTORY_PUBLIC_STOCK || 'auto', // -> NUXT_INVENTORY_PUBLIC_STOCK (auto | on | off)
    // Umbral de "stock bajo" (alertas y semáforo del panel), en unidades por talla.
    inventoryStockBajo: process.env.NUXT_INVENTORY_STOCK_BAJO || '5', // -> NUXT_INVENTORY_STOCK_BAJO
    // IMÁGENES de producto desde el panel: la API de Woo no sube medios; se usa la
    // REST API de WordPress (wp/v2/media) con una CONTRASEÑA DE APLICACIÓN
    // (WordPress → Usuarios → perfil → Contraseñas de aplicación). Solo servidor.
    wpAppUser: process.env.NUXT_WP_APP_USER || '',         // -> NUXT_WP_APP_USER (usuario de WordPress)
    wpAppPassword: process.env.NUXT_WP_APP_PASSWORD || '', // -> NUXT_WP_APP_PASSWORD (contraseña de aplicación, con o sin espacios)
    // Guarda PROPIA de imágenes (independiente de la de precios/stock). Default true:
    // solo se cambian imágenes de productos en BORRADOR (mismo criterio que
    // NUXT_INVENTORY_WOO_ONLY_DRAFTS). Poner 'false' explícitamente para abrir a publicados.
    imagesOnlyDrafts: process.env.NUXT_IMAGES_ONLY_DRAFTS ?? 'true', // -> NUXT_IMAGES_ONLY_DRAFTS (true | false)
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
      // ORIGEN DE LAS IMÁGENES de producto en la web (Fase B, construido y NO activado):
      //   local (default) = archivos del repo en /images/products (como siempre).
      //   woo             = la imagen principal y la galería que tenga WooCommerce;
      //                     si Woo no responde o al producto le falta imagen, cae
      //                     automáticamente a la local. El respaldo local es PERMANENTE.
      // Cambiar SOLO con la medición de docs/imagenes-woo-medicion.md en la mano.
      imagesSource: process.env.NUXT_PUBLIC_IMAGES_SOURCE || 'local', // -> NUXT_PUBLIC_IMAGES_SOURCE (local | woo)
    },
  },
})
