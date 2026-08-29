/** ¿Hay sesión? Lo consulta la página al cargar para decidir login vs bandeja. */
export default defineEventHandler((event) => {
  return { configured: inboxConfigured(), authenticated: hasValidSession(event), db: dbConfigured() }
})
