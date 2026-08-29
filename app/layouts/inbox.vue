<script setup lang="ts">
// Layout mínimo para herramientas internas (/admin/*): sin navbar, footer,
// carrito ni promos del sitio público.
</script>

<template>
  <div class="inbox-shell">
    <slot />
  </div>
</template>

<style scoped>
.inbox-shell {
  min-height: 100dvh;
  background: var(--hueso);
}
</style>
