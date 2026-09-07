#!/usr/bin/env node
// Confirma que el código desplegado es el que está en origin/<rama>.
//   node scripts/verificar-deploy.mjs                      → producción vs origin/master
//   node scripts/verificar-deploy.mjs <url> [rama] [--esperar]
// Con --esperar reintenta hasta 5 min (el deploy de Vercel tarda ~1 min).
// Sale con código 1 si no coincide: "el deploy no entró".
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const esperar = args.includes('--esperar')
const pos = args.filter(a => !a.startsWith('--'))
const url = (pos[0] || 'https://www.disfraceskustom.com').replace(/\/$/, '')
const rama = pos[1] || 'master'

execSync('git fetch -q origin', { stdio: 'inherit' })
const esperado = execSync(`git rev-parse origin/${rama}`).toString().trim()
const limite = Date.now() + (esperar ? 5 * 60_000 : 0)
for (;;) {
  let v = null
  try { v = await (await fetch(`${url}/api/version`, { cache: 'no-store' })).json() }
  catch (err) { v = { error: String(err.message ?? err) } }
  const ok = v?.commit === esperado
  console.log(`${ok ? '✅' : '❌'} ${url}: commit ${v?.commit_corto ?? v?.error ?? '?'} (${v?.rama ?? '?'}, ${v?.entorno ?? '?'}, build ${v?.build ?? '?'}) · origin/${rama} = ${esperado.slice(0, 7)}`)
  if (ok) process.exit(0)
  if (Date.now() >= limite) { console.error('El deploy NO entró: el hash desplegado no coincide con origin/' + rama + '. Revisa el check del commit en GitHub (Vercel) y vercel.json (crons ≤ 1/día en Hobby).'); process.exit(1) }
  await new Promise(r => setTimeout(r, 15_000))
}
