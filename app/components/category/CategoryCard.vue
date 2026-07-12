<script setup lang="ts">
interface Props {
  name: string
  slug?: string
  image?: string
}
defineProps<Props>()
</script>

<template>
  <NuxtLink :to="slug ? `/categoria/${slug}` : '#'" class="ccard">
    <div class="cph">
      <!-- se pide el cuadrado COMPLETO (400x400, sin recorte de ipx) y el CSS
           muestra solo la mitad frontal de la foto compuesta frente+espalda -->
      <NuxtImg v-if="image" :src="image" :alt="name" class="cphoto" width="400" height="400" />
      <PhotoPlaceholder v-else :caption="`[ ${name} ]\nfoto 4:5`" />
      <span class="cic">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </div>
    <span class="cname">{{ name }}</span>
  </NuxtLink>
</template>

<style scoped>
.ccard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  text-decoration: none;
  color: var(--ink);
}
.ccard .cph {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: var(--r-md);
  overflow: hidden;
  position: relative;
  border: 1px solid var(--line);
  background: #fff; /* las fotos viven sobre blanco (regla de marca) */
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.22s var(--ease-out), transform 0.22s var(--ease-out);
}
.ccard:hover .cph {
  box-shadow: var(--shadow-lift);
  transform: translateY(-5px);
}
/* SOLO FOTO FRONTAL (marketing jul 2026): la caja del img mide media foto
   (ancho = 50% × alto del contenedor; en 4:5 eso es 62.5% del ancho) y
   object-position left muestra exactamente la mitad frontal, figura completa,
   centrada con aire blanco a los lados. Los archivos NO se tocan. */
.ccard .cphoto {
  width: 62.5%;
  height: 100%;
  object-fit: cover;
  object-position: left center;
  display: block;
  margin-inline: auto;
}
.ccard .cic {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.14);
  z-index: 2;
}
.ccard .cname {
  font-weight: 600;
  font-size: 13.5px;
}
</style>
