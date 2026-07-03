<script setup lang="ts">
const { categories } = useProducts()
const { reveal } = useSiteMotion()

useHead({
  title: 'Kustom Disfraces — Disfraces para cada historia en Bogotá',
  meta: [{ name: 'description', content: 'Disfraces de calidad para niños, niñas, adultos y bebés en Bogotá. Superhéroes, anime, animales y más. Envío a toda Colombia.' }],
})
</script>

<template>
  <div>
  <!-- Raíz única obligatoria (el div de arriba, sin comentarios fuera de él):
       con pageTransition, un template multi-raíz rompe la navegación
       (la página destino nunca se monta) -->
  <!-- Zona texturizada: patrón espacial crema detrás de TODO, hero incluido
       (los brillos del hero pintan por encima; las cards van en blanco) -->
  <div class="textured">

  <!-- ===================== HERO (carrusel) ===================== -->
  <HeroCarousel />

  <!-- Marquee del eslogan (único uso en el sitio) -->
  <SloganMarquee />

  <!-- TrustBar tras el hero (en la Home el layout no la pinta arriba) -->
  <TrustBar />

  <!-- ===================== CATEGORÍAS ===================== -->
  <section class="section">
    <div v-motion v-bind="reveal()" class="section__head">
      <h2 class="section__title">Explora por categoría</h2>
    </div>
    <div class="cat-grid">
      <CategoryCard
        v-for="(c, i) in categories"
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
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-5);
}

@media (max-width: 1023px) {
  .cat-grid { grid-template-columns: repeat(4, 1fr); }
}
@media (max-width: 460px) {
  .cat-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
