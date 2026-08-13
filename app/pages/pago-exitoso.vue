<script setup lang="ts">
// Retorno de Mercado Pago tras un pago aprobado (back_url success).
useHead({
  title: 'Pago recibido — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <PaymentResult variant="exito" />
</template>
