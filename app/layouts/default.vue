<script setup lang="ts">
// TrustBar: encima del footer en TODAS las páginas (ajuste del equipo de
// marketing, jul 2026). Antes iba bajo el navbar (y tras el hero en la Home).
</script>

<template>
  <div class="shell">
    <AnnouncementBar />
    <AppNavbar />
    <main class="shell__main">
      <slot />
    </main>
    <TrustBar />
    <AppFooter />
    <CartDrawer />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  overflow-x: clip; /* red de seguridad contra desbordes horizontales en mobile */
}
.shell__main {
  flex: 1;
}
</style>
