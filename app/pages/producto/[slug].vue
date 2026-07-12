<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

const { bySlug, byCategory, categoryBySlug, pending } = useProducts()
const { contact } = useSiteNav()
const cart = useCartStore()

// Skeletons: hoy con ?skeleton=1; en Fase D los activa `pending`.
const showSkeleton = computed(() => pending.value || route.query.skeleton === '1')

const product = computed(() => bySlug(slug.value))

if (!product.value) {
  throw createError({ statusCode: 404, statusMessage: 'Producto no encontrado', fatal: true })
}

useHead(() => ({ title: `${product.value?.name} — Kustom Disfraces` }))

const category = computed(() => categoryBySlug(product.value!.categorySlug))

// ---------- selección ----------
const size = ref<number | string | null>(null)

const currentPrice = computed(() => product.value?.price ?? 0)
const savings = computed(() => {
  const reg = product.value?.regularPrice
  return reg && reg > currentPrice.value ? reg - currentPrice.value : 0
})
const currentImage = computed(() => product.value?.images?.[0])

// ---------- enlace cruzado Súper <-> Línea Entrada ----------
// Las líneas son productos SEPARADOS (decisión del cliente); si este producto
// tiene par, se ofrece un enlace discreto a la otra versión.
const parejaPrompt = computed(() => {
  if (!product.value?.pareja) return null
  return product.value.pareja.tipo === 'economico'
    ? '¿Buscas la versión económica?'
    : '¿Buscas el acabado premium?'
})

// ---------- agregar al carrito ----------
const added = ref(false)
const needsSize = ref(false)
// El aviso se apaga apenas el usuario elige talla
watch(size, (s) => { if (s !== null) needsSize.value = false })
function addToCart() {
  if (!product.value) return
  // OJO: comparar contra null, no truthiness — la talla 0 es falsy
  if (size.value === null) { needsSize.value = true; return }
  cart.add({
    productId: product.value.id,
    name: product.value.name,
    slug: product.value.slug,
    price: currentPrice.value,
    image: currentImage.value,
    size: size.value,
    quantity: 1,
  })
  added.value = true
  needsSize.value = false
  setTimeout(() => (added.value = false), 2200)
  cart.openDrawer() // feedback inmediato: el drawer muestra lo agregado
}

const waLink = computed(() => `${contact.whatsapp}?text=${encodeURIComponent(`Hola, me interesa el disfraz "${product.value?.name}". ¿Me ayudan?`)}`)

// ---------- relacionados ----------
const related = computed(() =>
  byCategory(product.value!.categorySlug).filter(p => p.id !== product.value!.id).slice(0, 4),
)

const perks = [
  { t: 'Envío a toda Colombia', icon: '<path d="M3 7h11v8H3z"/><path d="M14 10h4l3 3v2h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>' },
  { t: 'Pago contra entrega', icon: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>' },
  { t: 'Cambios fáciles', icon: '<path d="M4 12a8 8 0 0 1 13-6l3 2M20 12a8 8 0 0 1-13 6l-3-2"/>' },
]
</script>

<template>
  <div class="textured">
  <!-- Fondo crema texturizado global (decisión del cliente, jul 2026);
       la galería y las cards siguen sobre blanco (las fotos mandan).
       Div raíz único: gotcha pageTransition. -->
  <div v-if="product" class="pdp">
    <Breadcrumb
      :items="[
        { label: 'Inicio', to: '/' },
        { label: category?.name ?? '', to: `/categoria/${product.categorySlug}` },
        { label: product.name },
      ]"
    />

    <ProductDetailSkeleton v-if="showSkeleton" />

    <template v-else>
    <div class="pdp__top">
      <!-- ===================== GALERÍA ===================== -->
      <div class="gallery">
        <div class="gallery__main">
          <!-- fit inside: las fotos no cuadradas muestran el disfraz COMPLETO
               (la galería usa object-fit contain sobre fondo blanco) -->
          <NuxtImg
            v-if="currentImage"
            :src="currentImage"
            :alt="product.name"
            class="gallery__photo"
            width="800"
            height="800"
            fit="inside"
          />
          <PhotoPlaceholder v-else :caption="`[ ${product.name} ]`" />
        </div>
      </div>

      <!-- ===================== INFO ===================== -->
      <div class="info">
        <NuxtLink :to="`/categoria/${product.categorySlug}`" class="info__cat">{{ category?.name }}</NuxtLink>
        <h1 class="info__name">{{ product.name }}</h1>
        <p v-if="product.code" class="info__code">COD {{ product.code }}</p>

        <div class="info__price">
          <span class="info__now">{{ formatCOP(currentPrice) }}</span>
          <s v-if="product.regularPrice" class="info__old">{{ formatCOP(product.regularPrice) }}</s>
          <KBadge v-if="savings" variant="sale">Ahorras {{ formatCOP(savings) }}</KBadge>
        </div>

        <!-- enlace cruzado discreto a la otra línea (Súper <-> Línea Entrada) -->
        <p v-if="product.pareja" class="info__pareja">
          {{ parejaPrompt }}
          <NuxtLink :to="`/producto/${product.pareja.slug}`" class="info__parejalink">{{ product.pareja.name }} →</NuxtLink>
        </p>

        <p v-if="product.description" class="info__desc">{{ product.description }}</p>

        <ul v-if="product.includes?.length" class="includes">
          <li v-for="inc in product.includes" :key="inc" class="includes__item">{{ inc }}</li>
        </ul>

        <div class="field">
          <div class="field__label">
            <span>Talla</span>
            <span v-if="needsSize" class="field__hint">Elige una talla</span>
          </div>
          <SizeSelector v-model="size" :sizes="product.sizes" :disabled="product.soldOutSizes ?? []" />
        </div>

        <div class="actions">
          <KButton variant="primary" size="lg" block @click="addToCart">
            {{ added ? '✓ Agregado al carrito' : 'Agregar al carrito' }}
          </KButton>
          <KButton variant="whatsapp" size="lg" block :to="waLink">
            <template #icon-left>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2zm0 1.8a8.2 8.2 0 0 1 6.9 12.6l-.2.3.8 2.9-3-.8-.3.2A8.2 8.2 0 1 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 2.3 1 2.8.8 3.3.7.5 0 1.6-.6 1.8-1.3.2-.6.2-1.2.2-1.3-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.2-.5-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.2 0-.4.1-.5l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.5-.4-.5-.6-.5z"/>
              </svg>
            </template>
            Consultar por WhatsApp
          </KButton>
        </div>

        <div class="perks">
          <div v-for="(p, i) in perks" :key="i" class="perk">
            <span class="perk__ic">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" v-html="p.icon" />
            </span>
            {{ p.t }}
          </div>
        </div>
      </div>
    </div>

    <!-- ===================== RELACIONADOS ===================== -->
    <section v-if="related.length" class="rel">
      <h2 class="rel__title">También te puede gustar</h2>
      <div class="rel__grid">
        <ProductCard v-for="p in related" :key="p.id" :product="p" />
      </div>
    </section>
    </template>
  </div>
  </div>
</template>

<style scoped>
.pdp {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-5) var(--space-5) var(--space-8);
}
.pdp__top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-7);
  margin-top: var(--space-4);
}

/* ---------- galería ---------- */
.gallery__main {
  aspect-ratio: 1 / 1;
  border-radius: var(--r-lg);
  overflow: hidden;
  border: 1px solid var(--line);
  background: #fff;
}
.gallery__photo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
/* ---------- info ---------- */
.info__cat {
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--purple);
  text-decoration: none;
}
.info__cat:hover { color: var(--purple-d); }
.info__name {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  color: var(--ink);
  margin: var(--space-2) 0 var(--space-1);
}
.info__code {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mut-2);
  letter-spacing: 0.06em;
  margin-bottom: var(--space-4);
}
.info__price {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}
.info__now {
  font-weight: 800;
  font-size: var(--text-2xl);
  color: var(--ink);
}
.info__old {
  font-weight: 500;
  font-size: var(--text-md);
  color: var(--mut-2);
}
/* enlace cruzado Súper <-> Línea Entrada (discreto, bajo el precio) */
.info__pareja {
  font-size: 13px;
  color: var(--mut);
  margin: calc(var(--space-4) * -0.5) 0 var(--space-4);
}
.info__parejalink {
  font-weight: 700;
  color: var(--purple);
  text-decoration: none;
}
.info__parejalink:hover {
  color: var(--purple-d);
  text-decoration: underline;
}
.info__desc {
  color: var(--mut);
  font-size: var(--text-md);
  line-height: 1.5;
  margin-bottom: var(--space-4);
}
/* qué incluye el disfraz (chips, del catálogo) */
.includes {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0 0 var(--space-5);
}
.includes__item {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  background: var(--hueso);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  padding: 4px 12px;
}
.includes__item::before {
  content: '✓ ';
  color: var(--turq);
  font-weight: 700;
}
.field {
  margin-bottom: var(--space-5);
}
.field__label {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
}
.field__hint {
  color: var(--fucsia);
  font-weight: 600;
  font-size: 12px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-5) 0;
}
.perks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4) var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--line);
}
.perk {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.perk__ic { color: var(--purple); display: inline-flex; }

/* ---------- relacionados ---------- */
.rel {
  margin-top: var(--space-8);
}
.rel__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-2xl);
  color: var(--ink);
  margin-bottom: var(--space-5);
}
.rel__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

/* ---------- responsive ---------- */
@media (max-width: 900px) {
  .pdp__top { grid-template-columns: 1fr; gap: var(--space-5); }
  .rel__grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
