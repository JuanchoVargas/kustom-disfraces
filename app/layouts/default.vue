<script setup lang="ts">
// En la Homepage la TrustBar va DESPUÉS del hero (la renderiza index.vue);
// en el resto de páginas va aquí, bajo el navbar.
const route = useRoute()
const trustInLayout = computed(() => route.path !== '/')
</script>

<template>
  <div class="shell">
    <AnnouncementBar />
    <AppNavbar />
    <TrustBar v-if="trustInLayout" />
    <main class="shell__main">
      <slot />
    </main>
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
