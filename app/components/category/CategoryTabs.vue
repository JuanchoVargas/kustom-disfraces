<script setup lang="ts">
/**
 * Tabs de categoría de la PLP. Son NAVEGACIÓN real (NuxtLink a las rutas
 * /categoria/*), no filtrado client-side. La activa es una pill carbón.
 */
const props = defineProps<{ activeSlug: string }>()

// Públicos de la taxonomía oficial; los vacíos (Combos) se auto-ocultan.
const { publicos } = useCatalogNav()

// En mobile (scroll horizontal) la tab activa debe quedar visible al cargar.
// Se ajusta scrollLeft del contenedor (no scrollIntoView: movería la página).
const track = ref<HTMLElement | null>(null)
onMounted(() => {
  const el = track.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (!track.value || !el) return
  if (track.value.scrollWidth <= track.value.clientWidth) return
  track.value.scrollLeft = el.offsetLeft - (track.value.clientWidth - el.clientWidth) / 2
})
</script>

<template>
  <nav ref="track" class="cattabs" aria-label="Categorías">
    <NuxtLink
      v-for="c in publicos"
      :key="c.slug"
      :to="`/categoria/${c.slug}`"
      class="cattab"
      :class="{ on: c.slug === props.activeSlug }"
      :aria-current="c.slug === props.activeSlug ? 'page' : undefined"
    >
      {{ c.nombre }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.cattabs {
  display: flex;
  gap: var(--space-2);
  /* mobile-first: scroll horizontal sin wrap ni scrollbar visible */
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.cattabs::-webkit-scrollbar { display: none; }

.cattab {
  flex: 0 0 auto;
  font-family: var(--ff-body);
  font-weight: 600;
  font-size: var(--text-md);
  color: var(--ink);
  text-decoration: none;
  padding: 9px 20px;
  border-radius: var(--r-pill);
  background: transparent;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.cattab:hover {
  background: var(--line);
}
.cattab:focus-visible {
  outline: 2px solid var(--turq);
  outline-offset: 2px;
}
.cattab.on {
  background: var(--ink);
  color: #fff;
}

@media (prefers-reduced-motion: reduce) {
  .cattab { transition: none; }
}
</style>
