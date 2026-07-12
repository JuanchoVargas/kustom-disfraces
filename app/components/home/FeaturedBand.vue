<script setup lang="ts">
/**
 * FeaturedBand — banda carbón de destacados de la gama Súper Acolchado.
 * Fondo ink SÓLIDO, sin patrón (el pattern-ink es exclusivo del footer);
 * los productos van en cards blancas (las fotos viven siempre sobre blanco).
 */
const { products } = useProducts()
const { reveal } = useSiteMotion()

// Línea premium: prioriza los featured del catálogo y toma 4
const items = computed(() =>
  products
    .filter(p => p.subcategoriasNav?.includes('super'))
    .sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false))
    .slice(0, 4),
)
</script>

<template>
  <section class="feat-band">
    <div class="feat">
      <div v-motion v-bind="reveal()" class="feat__head">
        <div>
          <span class="feat__eyebrow">Gama premium</span>
          <h2 class="feat__title">Súper Acolchado</h2>
        </div>
        <NuxtLink to="/categoria/ninos" class="feat__link">Ver todo →</NuxtLink>
      </div>

      <div class="feat__grid">
        <div
          v-for="(p, i) in items"
          :key="p.id"
          v-motion
          v-bind="reveal(i * 70)"
          class="feat__cell"
        >
          <ProductCard :product="p" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.feat-band {
  background: var(--ink);
}
.feat {
  max-width: 1280px;
  margin: 0 auto;
  padding: 56px var(--space-5) 64px;
}
.feat__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}
.feat__eyebrow {
  display: block;
  color: var(--turq);
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  margin-bottom: 6px;
}
.feat__title {
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-2xl);
  color: #fff;
}
.feat__link {
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--turq);
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-out);
}
.feat__link:hover {
  color: #fff;
}

.feat__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-5);
}
.feat__cell {
  display: flex;
}
.feat__cell > :deep(.pcard) {
  width: 100%;
}

@media (max-width: 1023px) {
  .feat__grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
