<script setup lang="ts">
// Pixel de seguimiento de Métricool: presente en TODAS las vistas.
// El src se recalcula con la ruta actual (cache-buster) para que también
// registre las navegaciones cliente (SPA), no solo la carga inicial.
// El `hash` es el identificador de la cuenta y NO se toca.
const route = useRoute()
const metricoolSrc = computed(
  () =>
    `https://tracker.metricool.com/c3po.jpg?hash=580fb51c4c24e8374c94073bb9d41ddb&p=${encodeURIComponent(route.fullPath)}`,
)
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <!-- Métricool: pixel oculto (no afecta el layout), carga en cada vista -->
    <img :src="metricoolSrc" alt="" aria-hidden="true" width="1" height="1" class="metricool-pixel">
  </div>
</template>

<style>
.metricool-pixel {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
