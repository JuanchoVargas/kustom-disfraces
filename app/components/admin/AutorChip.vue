<script setup lang="ts">
/**
 * QUIÉN ERES — indicador permanente + selector.
 *
 * Va en la cabecera de las tres páginas de /admin. El nombre está SIEMPRE a la
 * vista con un "no soy yo" al lado, a propósito: con una sola contraseña
 * compartida, el riesgo real no es que nadie firme, es que alguien firme sin
 * darse cuenta con el nombre del anterior y el historial pase de vacío a falso.
 *
 * El selector se abre solo si hay sesión y todavía no se eligió nombre.
 */
const { autor, autores, pidiendo, elegir, olvidar } = useAutor()
</script>

<template>
  <span v-if="autores.length" class="quien">
    <template v-if="autor">
      <span class="quien__nombre" :title="`Tus cambios quedan firmados como ${autor}`">🧑 {{ autor }}</span>
      <button class="quien__link" type="button" @click="olvidar">no soy yo</button>
    </template>
    <button v-else class="quien__pedir" type="button" @click="pidiendo = true">¿Quién eres?</button>

    <!-- Al entrar sin nombre elegido se pide antes de dejar escribir. -->
    <div v-if="pidiendo" class="quien__modal" @click.self="autor ? (pidiendo = false) : null">
      <div class="quien__box" role="dialog" aria-label="¿Quién eres?">
        <h3>¿Quién eres?</h3>
        <p class="quien__ayuda">
          Se queda guardado en este navegador y firma lo que cambies: precios, stock y
          las respuestas que envíes a clientes. Si compartes el computador, cámbialo
          con “no soy yo”.
        </p>
        <div class="quien__opciones">
          <button v-for="a in autores" :key="a" class="quien__op" type="button" @click="elegir(a)">{{ a }}</button>
        </div>
      </div>
    </div>
  </span>
</template>

<style scoped>
.quien { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.quien__nombre { font-weight: 700; white-space: nowrap; }
.quien__link, .quien__pedir { background: none; border: 0; padding: 0; cursor: pointer; font: inherit; text-decoration: underline; color: var(--mut, #6b6b6b); }
.quien__pedir { font-weight: 700; color: #8A1C2B; }
.quien__modal { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: grid; place-items: center; z-index: 60; padding: 16px; }
.quien__box { background: #fff; border-radius: 16px; padding: 20px; max-width: 420px; width: 100%; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.quien__box h3 { margin: 0 0 6px; font-size: 18px; }
.quien__ayuda { margin: 0 0 14px; font-size: 13px; line-height: 1.5; color: var(--mut, #6b6b6b); }
.quien__opciones { display: flex; flex-wrap: wrap; gap: 8px; }
.quien__op { flex: 1 1 120px; padding: 12px 14px; border-radius: 12px; border: 1px solid #ddd; background: #fafafa; font: inherit; font-weight: 700; cursor: pointer; }
.quien__op:hover { background: var(--purple-soft, #efe9fb); border-color: var(--purple, #6b3fa0); }
</style>
