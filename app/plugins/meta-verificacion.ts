/**
 * Verificación de dominio de Meta (opcional). Si NUXT_PUBLIC_META_DOMAIN_VERIFICATION
 * tiene valor, se añade <meta name="facebook-domain-verification"> al head en el SSR
 * (el verificador de Meta lee el HTML). Independiente del pixel: funciona aunque el
 * ID esté vacío. Sin valor no se añade nada.
 */
export default defineNuxtPlugin(() => {
  const codigo = String(useRuntimeConfig().public.metaDomainVerification || '').trim()
  if (!codigo) return
  useHead({ meta: [{ name: 'facebook-domain-verification', content: codigo }] })
})
