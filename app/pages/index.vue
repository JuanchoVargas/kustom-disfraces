<script setup lang="ts">
const { categories, byPublico } = useProducts()
const { reveal } = useSiteMotion()

// Solo categorías con productos visibles: las vacías ("muy pronto", p. ej.
// Caballeros hoy) no se muestran en el home hasta tener catálogo/fotos.
// Se reactivan solas cuando byPublico deja de estar vacío.
const shownCategories = computed(() => categories.filter(c => byPublico(c.slug).length > 0))

useHead({
  title: 'Kustom Disfraces — Disfraces para cada historia en Bogotá',
  meta: [{ name: 'description', content: 'Disfraces de calidad para niños, niñas, damas, caballeros y bebés en Bogotá. Superhéroes, anime, animales y más. Envío gratis a todo el país.' }],
})
</script>

<template>
  <div>
  <!-- Raíz única obligatoria (el div de arriba, sin comentarios fuera de él):
       con pageTransition, un template multi-raíz rompe la navegación
       (la página destino nunca se monta) -->
  <!-- ===================== HERO (carrusel) ===================== -->
  <!-- Zona texturizada propia: el hero expone más patrón en sus vacíos,
       va con --pattern-opacity-hero (más baja que el resto) -->
  <div class="textured textured--hero">
    <HeroCarousel />
  </div>

  <!-- Banner 20% dcto (full-width, morado): mensaje del descuento en el home.
       El envío gratis vive en la barra superior; el flotante (PDP) repite el
       20%. Distribución aprobada por el cliente (sep 2026). -->
  <DiscountBanner />

  <!-- Zona texturizada estándar: patrón crema a 0.045 detrás del resto
       de secciones (las cards van en blanco encima) -->
  <div class="textured">

  <!-- Marquee del eslogan (único uso en el sitio) -->
  <!-- La TrustBar ya no va aquí: el layout la pinta encima del footer -->
  <SloganMarquee />

  <!-- ===================== CATEGORÍAS ===================== -->
  <section class="section">
    <div v-motion v-bind="reveal()" class="section__head">
      <h2 class="section__title">Explora por categoría</h2>
    </div>
    <div class="cat-grid" :style="{ '--cols': shownCategories.length }">
      <CategoryCard
        v-for="(c, i) in shownCategories"
        :key="c.slug"
        v-motion
        v-bind="reveal(i * 60)"
        :name="c.name"
        :slug="c.slug"
        :image="c.images?.[0]"
      />
    </div>
  </section>

  <!-- ===================== DESTACADOS (banda carbón, full-width) ===================== -->
  <!-- Ink sólido SIN patrón (el pattern-ink es exclusivo del footer) -->
  <FeaturedBand />

  <!-- ===================== BANDA KO (morada, full-width) ===================== -->
  <!-- Único uso permitido del pattern-morado; va directa contra el footer ink -->
  <KoBlock />

  </div><!-- /textured -->
  </div>
</template>

<style scoped>
/* La textura .textured es utilidad global (main.css) */
.section {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--space-7) var(--space-5);
}
.section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.section__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-2xl);
  color: var(--ink);
}
.section__link {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--purple);
  text-decoration: none;
  white-space: nowrap;
}
.section__link:hover { color: var(--purple-d); }

.cat-grid {
  display: grid;
  /* una columna por categoría mostrada (desktop); --cols lo fija el template.
     Los breakpoints de abajo lo sobreescriben en mobile. */
  grid-template-columns: repeat(var(--cols, 5), 1fr);
  gap: var(--space-5);
}

@media (max-width: 1023px) {
  .cat-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 460px) {
  .cat-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
