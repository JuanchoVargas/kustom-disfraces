<script setup lang="ts">
interface Slide {
  eyebrow: string
  title: string
  accent: string
  subtitle: string
  ctaPrimary: { label: string, to: string }
  ctaSecondary?: { label: string, to: string }
  blobA: string
  blobB: string
  image: string
  imageAlt: string
}

// Cada slide = una campaña/temporada. Sobrio, editorial.
const slides: Slide[] = [
  {
    eyebrow: '🦸 Catálogo 2026',
    title: 'Disfraces para ',
    accent: 'cada historia',
    subtitle: 'Superhéroes acolchados con calidad premium. Encuentra tu personaje, elige tu talla y recíbelo en casa — envío a toda Colombia.',
    ctaPrimary: { label: 'Ver niños', to: '/categoria/ninos' },
    ctaSecondary: { label: 'Cómo comprar', to: '/como-comprar' },
    blobA: 'var(--purple)',
    blobB: 'var(--turq)',
    image: '/images/products/spider-man-clasico-super-acolchado.webp',
    imageAlt: 'Disfraz Spider-Man Clásico Súper Acolchado, vista frente y espalda',
  },
  {
    eyebrow: '⭐ Colección Niñas',
    title: 'Heroínas ',
    accent: 'a su medida',
    subtitle: 'Vestidos de superheroínas, trusas y personajes de anime. Telas suaves y tallas desde los 2 años.',
    ctaPrimary: { label: 'Ver niñas', to: '/categoria/ninas' },
    ctaSecondary: { label: 'Ver niños', to: '/categoria/ninos' },
    blobA: 'var(--fucsia)',
    blobB: 'var(--purple)',
    image: '/images/products/mujer-maravilla.webp',
    imageAlt: 'Disfraz Mujer Maravilla para niña, vestido con capa y tiara',
  },
  {
    eyebrow: '🐣 Línea Bebés',
    title: 'Sus primeras ',
    accent: 'aventuras',
    subtitle: 'Animalitos abrigados y suaves desde talla Bebé: pollito, vaquita, Stitch y más.',
    ctaPrimary: { label: 'Ver bebés', to: '/categoria/bebes' },
    ctaSecondary: { label: 'Cómo comprar', to: '/como-comprar' },
    blobA: 'var(--turq)',
    blobB: 'var(--yellow)',
    image: '/images/products/pollito.webp',
    imageAlt: 'Disfraz de pollito para bebé, enterizo amarillo con capota',
  },
]

const reduced = usePreferredReducedMotion()
const isReduced = computed(() => reduced.value === 'reduce')

const active = ref(0)
const count = slides.length
const current = computed(() => slides[active.value])

function go(i: number) {
  active.value = (i + count) % count
}
function next() {
  go(active.value + 1)
}

// Autoplay lento, con pausa al hover; desactivado si movimiento reducido.
const { pause, resume } = useIntervalFn(next, 5500, { immediate: false })
onMounted(() => {
  if (!isReduced.value) resume()
})
function onLeave() {
  if (!isReduced.value) resume()
}
</script>

<template>
  <section
    class="hero"
    aria-roledescription="carrusel"
    aria-label="Campañas destacadas"
    @mouseenter="pause"
    @mouseleave="onLeave"
  >
    <!-- Formas orgánicas: CONTENIDAS dentro del hero, al fondo -->
    <div class="hero__shapes" aria-hidden="true">
      <span class="blob blob--a" :style="{ background: current.blobA }" />
      <span class="blob blob--b" :style="{ background: current.blobB }" />
    </div>

    <Transition :css="!isReduced" name="hslide" mode="out-in" appear>
      <div :key="active" class="hero__slide">
        <div class="hero__text">
          <KTag color="yellow">{{ current.eyebrow }}</KTag>
          <h1 class="hero__title">
            {{ current.title }}<span class="accent">{{ current.accent }}</span>
          </h1>
          <p class="hero__sub">{{ current.subtitle }}</p>
          <div class="hero__cta">
            <KButton variant="primary" size="lg" :to="current.ctaPrimary.to">{{ current.ctaPrimary.label }}</KButton>
            <KButton v-if="current.ctaSecondary" variant="line" size="lg" :to="current.ctaSecondary.to">
              {{ current.ctaSecondary.label }}
            </KButton>
          </div>
        </div>
        <div class="hero__media">
          <img :src="current.image" :alt="current.imageAlt" class="hero__img">
        </div>
      </div>
    </Transition>

    <div class="hero__dots" role="tablist" aria-label="Elegir campaña">
      <button
        v-for="(s, i) in slides"
        :key="i"
        type="button"
        class="dot"
        :class="{ on: i === active }"
        role="tab"
        :aria-selected="i === active"
        :aria-label="`Campaña ${i + 1}`"
        @click="go(i)"
      />
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  max-width: 1280px;
  margin: 0 auto;
  /* bottom compacto: los dots quedan pegados al contenido, no huérfanos */
  padding: var(--space-7) var(--space-5) var(--space-6);
  display: grid;
  place-items: center;
  overflow: hidden; /* contiene las formas orgánicas */
}
@media (min-width: 721px) {
  .hero { min-height: 510px; }
}

/* ---------- formas orgánicas (fondo, contenidas) ---------- */
.hero__shapes {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  animation: shapesIn 1.1s var(--ease-out) both;
}
.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(48px);
  display: block;
  transition: background-color 0.6s var(--ease-out);
}
.blob--a {
  width: 340px;
  height: 340px;
  opacity: 0.16;
  top: -40px;
  left: -30px;
}
.blob--b {
  width: 280px;
  height: 280px;
  opacity: 0.14;
  bottom: -40px;
  right: 4%;
}
@keyframes shapesIn {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: none; }
}

/* ---------- slide ---------- */
.hero__slide {
  position: relative;
  z-index: 1;
  width: 100%;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: var(--space-6);
  align-items: center;
}
.hero__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-4xl);
  line-height: 1.04;
  color: var(--ink);
  margin: var(--space-3) 0;
}
.hero__title .accent { color: var(--purple); }
.hero__sub {
  color: var(--mut);
  font-size: var(--text-lg);
  line-height: 1.5;
  max-width: 48ch;
}
.hero__cta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-5);
}
.hero__img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: contain;
  border-radius: var(--r-lg);
  background: #fff;
  border: 1px solid var(--line);
  /* misma sombra de reposo del sistema de cards: la superficie blanca
     flota con intención sobre el crema texturizado */
  box-shadow: var(--shadow-card);
  display: block;
}

/* ---------- dots ---------- */
.hero__dots {
  position: absolute;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  gap: 8px;
}
.dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border: 0;
  border-radius: var(--r-pill);
  background: var(--line-2);
  cursor: pointer;
  transition: width 0.3s var(--ease-out), background-color 0.3s var(--ease-out);
}
.dot:hover { background: var(--mut-2); }
.dot.on {
  width: 26px;
  background: var(--purple);
}

/* ---------- transición de slide (cross-fade sutil) ---------- */
.hslide-enter-active { transition: opacity 0.55s var(--ease-out), transform 0.55s var(--ease-out); }
.hslide-leave-active { transition: opacity 0.35s var(--ease-out), transform 0.35s var(--ease-out); }
.hslide-enter-from { opacity: 0; transform: translateY(14px); }
.hslide-leave-to { opacity: 0; transform: translateY(-10px); }

/* ---------- responsive ---------- */
@media (max-width: 720px) {
  .hero {
    padding: var(--space-5) var(--space-5) var(--space-8);
  }
  .hero__slide {
    grid-template-columns: 1fr;
    gap: var(--space-5);
  }
  .hero__media { order: -1; }
  .hero__title { font-size: var(--text-3xl); }
}

/* ---------- accesibilidad: sin animaciones de fondo ---------- */
@media (prefers-reduced-motion: reduce) {
  .hero__shapes { animation: none; }
  .blob { transition: none; }
  .dot { transition: none; }
}
</style>
