<script setup lang="ts">
// Retorno de Mercado Pago con pago pendiente/en proceso (back_url pending).
useHead({
  title: 'Pago pendiente — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <PaymentResult variant="pendiente" />
</template>
