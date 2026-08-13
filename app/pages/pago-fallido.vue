<script setup lang="ts">
// Retorno de Mercado Pago tras un pago rechazado/cancelado (back_url failure).
useHead({
  title: 'El pago no se completó — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <PaymentResult variant="fallido" />
</template>
