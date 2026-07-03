<script setup lang="ts">
/**
 * KoBlock — banda de marca "Conoce a KO", a todo el ancho de la página.
 * ÚNICO uso permitido del pattern-morado (tile opaco del pack, intensidad
 * de fábrica); el Morado Kustom de base asoma solo mientras carga el tile.
 * Pose: ko-apunta — KO va a la izquierda señalando el texto a su derecha.
 */
const { reveal } = useSiteMotion()
</script>

<template>
  <section class="ko-band">
    <div class="ko">
      <div v-motion v-bind="reveal()" class="ko-mascot">
        <img
          src="/images/ko/ko-apunta.webp"
          alt="KO, el alien mascota de Kustom, señalando el mensaje"
          class="ko-img"
          loading="lazy"
        >
      </div>

      <div v-motion v-bind="reveal(120)" class="ko-text">
        <span class="ko-eyebrow">Conoce a KO</span>
        <h2>Nuestro alien favorito</h2>
        <!-- Copy contenido: KO no "acompaña" ni "celebra tu elección" — la
             mascota solo aparece en su bloque y en estados especiales -->
        <p>
          KO aterrizó de otra galaxia y se quedó en Kustom por los disfraces.
          Aparece solo en ocasiones especiales; si te lo cruzas por aquí, es
          porque está celebrando que cada historia encuentre el suyo.
        </p>
        <NuxtLink to="/categoria/ninos" class="ko-cta">Explora el catálogo</NuxtLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ko-band {
  /* Morado Kustom de base + patrón espacial morado (tile del pack) */
  background-color: var(--purple);
  background-image: url('/images/pattern-morado.webp');
  background-repeat: repeat;
  background-size: 480px auto;
}
.ko {
  max-width: 1120px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: var(--space-7);
  align-items: center;
  padding: 56px var(--space-5);
}
.ko-mascot {
  display: grid;
  place-items: center;
}
.ko-img {
  height: 280px;
  width: auto;
  filter: drop-shadow(0 12px 18px rgba(17, 17, 17, 0.3));
}
.ko-eyebrow {
  color: var(--yellow);
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}
.ko h2 {
  color: #fff;
  font-family: var(--ff-display);
  font-weight: 400;
  font-size: var(--text-3xl);
  line-height: 1.05;
  margin: 12px 0 12px;
}
.ko p {
  /* cuerpo sobre morado: casi blanco + semibold + 16px para asegurar AA */
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.55;
  max-width: 52ch;
  margin-bottom: 24px;
}
/* CTA secundario: outline blanco discreto (la banda es de marca, no de venta) */
.ko-cta {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 var(--space-5);
  border: 1.5px solid rgba(255, 255, 255, 0.7);
  border-radius: var(--r-md);
  color: #fff;
  font-weight: 600;
  font-size: var(--text-md);
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}
.ko-cta:hover {
  background-color: rgba(255, 255, 255, 0.14);
  border-color: #fff;
}
.ko-cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--purple), 0 0 0 5px #fff;
}

@media (max-width: 720px) {
  .ko {
    grid-template-columns: 1fr;
    gap: var(--space-4);
    text-align: center;
    padding: 40px var(--space-5) 48px;
  }
  .ko-mascot {
    margin-bottom: 8px;
  }
  .ko-img {
    height: 220px;
  }
  .ko p {
    margin-inline: auto;
  }
}
</style>
