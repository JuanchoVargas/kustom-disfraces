import { dbConfigured, ensureSchema, sql } from '../../utils/db'
import { createMailTransport, mailerConfigured } from '../../utils/mailer'
import { WA_WINDOW_MS } from '../../utils/inbox'

/**
 * AVISO DE VENTANA DE 24 H POR VENCER (WhatsApp). 21 conversaciones se perdieron
 * porque nadie respondió a tiempo. Este cron busca conversaciones de WhatsApp en
 * estado HUMANO cuyo último mensaje del cliente tiene entre 20 y 24 h y ningún
 * agente respondió después, y manda UN correo a ventas@ listándolas (con enlace a
 * cada una). Cada conversación se avisa una sola vez por ventana (ventana_aviso_at).
 * Schedule sugerido: cada hora (vercel.json). Idempotente y best-effort.
 */
const AVISO_H = 20

export default defineEventHandler(async () => {
  const t0 = Date.now()
  if (!dbConfigured()) return { ok: false, db: 'sin_configurar' }
  await ensureSchema()
  const q = sql()
  await q.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ventana_aviso_at TIMESTAMPTZ`)
  const rows = await q.query(
    `SELECT c.id, c.nombre, c.external_id, c.telefono, c.telefono_lead, c.ultimo_cliente_at, c.ultimo_mensaje,
            EXTRACT(EPOCH FROM (now() - c.ultimo_cliente_at))/3600 AS horas
     FROM conversations c
     WHERE c.canal = 'wa' AND c.estado = 'humano'
       AND c.ultimo_cliente_at IS NOT NULL
       AND c.ultimo_cliente_at < now() - interval '${AVISO_H} hours'
       AND c.ultimo_cliente_at > now() - interval '24 hours'
       AND (c.ventana_aviso_at IS NULL OR c.ventana_aviso_at < c.ultimo_cliente_at)
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direccion = 'out' AND m.autor = 'agente' AND m.created_at > c.ultimo_cliente_at)
     ORDER BY c.ultimo_cliente_at ASC`,
  ) as any[]
  if (!rows.length) return { ok: true, por_vencer: 0, enviado: false, ms: Date.now() - t0 }

  const site = (useRuntimeConfig().public.siteUrl || 'https://www.disfraceskustom.com').replace(/\/$/, '')
  const c = useRuntimeConfig()
  const fmt = (r: any) => {
    const vence = new Date(new Date(r.ultimo_cliente_at).getTime() + WA_WINDOW_MS)
    const minutos = Math.max(0, Math.round((vence.getTime() - Date.now()) / 60000))
    const quien = r.nombre || r.telefono || r.external_id
    const tel = r.telefono_lead ? ` · celular dejado: ${r.telefono_lead}` : r.telefono ? ` · +${r.telefono}` : ''
    return { quien, tel, minutos, ultimo: String(r.ultimo_mensaje ?? '').slice(0, 120), url: `${site}/admin/chats?c=${r.id}` }
  }
  const items = rows.map(fmt)
  const text = [
    `Estas conversaciones de WhatsApp en atención humana llevan más de ${AVISO_H} horas sin respuesta. Cuando pase la ventana de 24 h ya no se les podrá escribir libremente (solo con plantilla).`,
    '',
    ...items.map(i => `• ${i.quien}${i.tel} — vence en ${i.minutos} min — "${i.ultimo}"\n  ${i.url}`),
  ].join('\n')
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Estas conversaciones de WhatsApp en <b>atención humana</b> llevan más de ${AVISO_H} horas sin respuesta. Cuando pase la ventana de 24 h ya no se les podrá escribir libremente (solo con plantilla).</p><ul>${items.map(i => `<li style="margin:8px 0"><b>${i.quien}</b>${i.tel} — <span style="color:#B00020">vence en ${i.minutos} min</span><br><i>"${i.ultimo}"</i><br><a href="${i.url}">Abrir en la bandeja</a></li>`).join('')}</ul></div>`
  const subject = `⏳ ${items.length} chat${items.length === 1 ? '' : 's'} de WhatsApp por vencer sin respuesta`

  let enviado = false
  if (mailerConfigured()) {
    try {
      await createMailTransport().sendMail({ from: c.smtpFrom || c.smtpUser, to: c.ventasTo, subject, text, html })
      enviado = true
    }
    catch (err) {
      console.error('[ventana-24h] fallo al enviar el correo:', String((err as Error)?.message ?? err))
    }
  }
  else console.warn('[ventana-24h] SMTP sin configurar — no se envía:', subject)
  if (enviado) await q.query(`UPDATE conversations SET ventana_aviso_at = now() WHERE id = ANY($1::bigint[])`, [rows.map(r => r.id)])
  console.info(`[ventana-24h] ${items.length} por vencer · enviado=${enviado}: ${items.map(i => i.quien).join(', ')}`)
  return { ok: true, por_vencer: items.length, enviado, conversaciones: items.map(i => ({ quien: i.quien, minutos: i.minutos, url: i.url })), ms: Date.now() - t0 }
})
