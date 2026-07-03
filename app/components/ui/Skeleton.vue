<script setup lang="ts">
/**
 * Skeleton — bloque base de carga (shimmer). Componible para cards/PDP.
 * Sirve doble: vida ahora + loading states reales en Fase D.
 */
withDefaults(defineProps<{
  w?: string
  h?: string
  radius?: string
  circle?: boolean
}>(), {
  w: '100%',
  h: '1em',
  radius: 'var(--r-sm)',
  circle: false,
})
</script>

<template>
  <span
    class="sk"
    :style="{ width: w, height: h, borderRadius: circle ? '50%' : radius }"
    aria-hidden="true"
  />
</template>

<style scoped>
.sk {
  display: block;
  flex-shrink: 0;
  background: linear-gradient(100deg, var(--line) 28%, #f1efe9 48%, var(--line) 68%);
  background-size: 200% 100%;
  animation: sk-shimmer 1.4s ease-in-out infinite;
}
@keyframes sk-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
    background: var(--line);
  }
}
</style>
