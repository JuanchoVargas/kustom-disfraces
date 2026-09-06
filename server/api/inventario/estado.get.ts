/** Estado del módulo: adaptador activo, modo simulación, conteos y edad del snapshot. */
export default defineEventHandler(async (event) => {
  requireInbox(event)
  return await inventoryStatus()
})
