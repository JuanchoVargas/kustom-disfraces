<script setup lang="ts">
// Retorno de Mercado Pago tras un pago aprobado (back_url success).
useHead({
  title: 'Pago recibido — Kustom Disfraces',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

// Meta Pixel — Purchase SOLO si MP devolvió status=approved, con eventID = payment_id
// y el total guardado al iniciar el pago; no se repite al recargar. Esta página es
// informativa: la confirmación real del pago la da el webhook.
const route = useRoute()
const pixel = useMetaPixel()
onMounted(() => { pixel.purchaseSiAprobado(route.query as Record<string, unknown>) })
</script>

<template>
  <PaymentResult variant="exito" />
</template>
