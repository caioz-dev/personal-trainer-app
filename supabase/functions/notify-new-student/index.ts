import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_URL   = 'https://personal-trainer-app-ten.vercel.app'
const FROM      = 'PersonalPro <aviso@notificacoes.drluangalvao.com.br>'
const RECENT_MS = 10 * 60 * 1000   // new_signup: conta criada há até 10 min
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE  = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,24}$/i

// B13: o personal que recebe o aviso de cadastro vem de secret, não do código.
// Ex.: supabase secrets set SIGNUP_NOTIFY_PERSONAL_EMAIL=luangalvaoef@gmail.com
const SIGNUP_RECIPIENT_ENV = 'SIGNUP_NOTIFY_PERSONAL_EMAIL'

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function ctaButtonHTML(url: string, label: string): string {
  return `
      <div style="text-align:center;margin-bottom:1.5rem">
        <a href="${escHtml(url)}" style="display:inline-block;background:#567FFF;color:#fff;font-weight:700;font-size:.9rem;text-decoration:none;padding:.75rem 1.75rem;border-radius:999px">${escHtml(label)}</a>
      </div>`
}

// Recebe só valores já escapados em bodyHtml; title/ícone são constantes do código.
function emailShell(accentFrom: string, accentTo: string, icon: string, title: string, titleColor: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F5F7;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#01040C;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,${accentFrom} 0%,${accentTo} 100%);padding:2rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">${icon}</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.02em">PersonalPro</div>
    </div>
    <div style="padding:2rem">
      <h2 style="color:${titleColor};font-size:1.1rem;margin:0 0 1rem;font-weight:700">${escHtml(title)}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:1rem 2rem;border-top:1px solid rgba(144,158,186,.1);text-align:center">
      <p style="color:#4a5269;font-size:.75rem;margin:0">Você recebeu este e-mail porque usa o PersonalPro como personal trainer.</p>
    </div>
  </div>
</body>
</html>`
}

async function sendEmail(to: string, subject: string, html: string, tag: string): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) { console.error(`[${tag}] RESEND_API_KEY ausente`); return null }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  })
  if (!res.ok) { console.error(`[${tag}] Resend respondeu ${res.status}`); return null }
  const out = await res.json().catch(() => ({}))
  return out?.id ?? 'sem-id'
}

const FAILURE_MESSAGES: Record<string, string> = {
  not_found:  'Tentativa de vincular um aluno pelo e-mail abaixo falhou — verifique se esse aluno já criou uma conta no PersonalPro.',
  wrong_role: 'O e-mail abaixo pertence a uma conta de personal trainer, não de aluno — não foi possível vinculá-lo como aluno.',
  link_error: 'Não foi possível concluir o vínculo com o aluno do e-mail abaixo devido a um erro técnico. Tente novamente em instantes.',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const TAG = 'notify-new-student'
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'unauthorized' })

    // Quem chama vem só do JWT
    const sbAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await sbAuth.auth.getUser()
    if (!user) return json(401, { error: 'unauthorized' })

    const body = await req.json().catch(() => ({}))
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // ── Modo new_signup: aviso de cadastro, antes de qualquer vínculo ──────────────
    // Só o próprio aluno recém-criado, uma vez por conta. Nome e e-mail vêm do perfil
    // no banco; student_name/student_email do corpo são ignorados.
    if (body?.type === 'new_signup') {
      const { data: me } = await sb.from('profiles')
        .select('id, name, email, role, created_at').eq('id', user.id).maybeSingle()
      if (!me || me.role !== 'student') return json(403, { error: 'forbidden' })
      if (Date.now() - new Date(me.created_at).getTime() > RECENT_MS) return json(409, { error: 'not_recent' })

      // Destinatário antes de tudo: falta de configuração não consome o envio único, e uma
      // conta já avisada (skipped) só responde 200 se o secret existe e aponta para um
      // personal — isso permite conferir a configuração sem enviar e-mail.
      const recipientEmail = (Deno.env.get(SIGNUP_RECIPIENT_ENV) || '').trim().toLowerCase()
      if (!recipientEmail) { console.error(`[${TAG}] new_signup: ${SIGNUP_RECIPIENT_ENV} não configurado`); return json(503, { error: 'not_configured' }) }
      const { data: recipient } = await sb.from('profiles')
        .select('id, name, email').ilike('email', recipientEmail).eq('role', 'personal').maybeSingle()
      if (!recipient?.email) { console.error(`[${TAG}] new_signup: personal destinatário não encontrado`); return json(503, { error: 'not_configured' }) }

      if (user.app_metadata?.signup_notified_at) return json(200, { ok: true, skipped: true })

      // Uma vez por conta: marca em app_metadata (só a service role altera) ANTES de enviar,
      // assim chamadas repetidas não reenviam; se o envio falhar, desfaz a marca. Uma corrida de
      // 2 chamadas simultâneas ainda poderia passar as duas — aceitável aqui (só o próprio
      // aluno, na janela de 10 min).
      const baseMeta = { ...(user.app_metadata || {}) }
      const { error: markErr } = await sb.auth.admin.updateUserById(user.id, {
        app_metadata: { ...baseMeta, signup_notified_at: new Date().toISOString() },
      })
      if (markErr) { console.error(`[${TAG}] new_signup: falha ao marcar`, { user_id: user.id }); return json(500, { error: 'internal_error' }) }

      const displayName = me.name || 'Aluno'
      const html = emailShell('#567FFF', '#4ADE80', '🆕', 'Novo aluno se cadastrou no app', '#4ADE80', `
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1.25rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${escHtml(recipient.name || 'Personal')}</strong>! Um novo aluno acabou de se cadastrar no PersonalPro:
      </p>
      <div style="background:rgba(86,115,255,.1);border:1px solid rgba(86,115,255,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:1rem;font-weight:700;color:#93AEFF;margin-bottom:.3rem">${escHtml(displayName)}</div>
        <div style="font-size:.82rem;color:#8f9ab2">✉️ ${escHtml(me.email)}</div>
      </div>
      ${ctaButtonHTML(APP_URL, 'Abrir o PersonalPro')}
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Nenhuma ação necessária ainda — isso é só um aviso de que a conta foi criada. Quando você vincular esse aluno pelo app, um segundo e-mail confirma o vínculo.
      </p>`)

      const emailId = await sendEmail(recipient.email, 'Novo cadastro no PersonalPro', html, TAG)
      if (!emailId) {
        // Desfaz a marca (null conta como "não enviado") para permitir nova tentativa
        await sb.auth.admin.updateUserById(user.id, { app_metadata: { ...baseMeta, signup_notified_at: null } })
        return json(502, { error: 'email_failed' })
      }

      // Notificação in-app (o aluno não tem RLS para gravar notificação do personal)
      const { error: notifErr } = await sb.from('notifications').insert({
        personal_id: recipient.id,
        tipo:        'novo_cadastro',
        mensagem:    `Um novo aluno se cadastrou no PersonalPro: ${displayName} (${me.email})`,
      })
      if (notifErr) console.error(`[${TAG}] new_signup: falha ao gravar notificação`, { personal_id: recipient.id })

      console.log(`[${TAG}] new_signup enviado`, { email_id: emailId, student_id: me.id, personal_id: recipient.id })
      return json(200, { ok: true })
    }

    // ── Modos vínculo (sucesso/falha): o chamador é o personal, e o e-mail vai para ele ──
    const { data: personal } = await sb.from('profiles').select('id, name, email, role').eq('id', user.id).maybeSingle()
    if (!personal?.email || personal.role !== 'personal') return json(403, { error: 'forbidden' })

    let subject: string
    let html: string

    if (body?.student_id !== undefined) {
      // ── Sucesso: aluno vinculado. Precisa existir vínculo ativo do chamador com o aluno. ──
      const studentId = body.student_id
      if (typeof studentId !== 'string' || !UUID_RE.test(studentId)) return json(400, { error: 'invalid_request' })
      const { data: link } = await sb.from('personal_students').select('id')
        .eq('personal_id', user.id).eq('student_id', studentId).eq('active', true).maybeSingle()
      if (!link) return json(403, { error: 'forbidden' })

      const { data: student } = await sb.from('profiles').select('name, email').eq('id', studentId).maybeSingle()
      if (!student?.email) return json(404, { error: 'not_found' })

      subject = 'Novo aluno vinculado — PersonalPro'
      html = emailShell('#567FFF', '#4ADE80', '🎉', 'Novo aluno vinculado à sua conta!', '#4ADE80', `
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1.25rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${escHtml(personal.name || 'Personal')}</strong>! Um aluno acabou de ser vinculado à sua conta no PersonalPro:
      </p>
      <div style="background:rgba(86,115,255,.1);border:1px solid rgba(86,115,255,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:1rem;font-weight:700;color:#93AEFF;margin-bottom:.3rem">${escHtml(student.name || 'Aluno')}</div>
        <div style="font-size:.82rem;color:#8f9ab2">✉️ ${escHtml(student.email)}</div>
      </div>
      ${ctaButtonHTML(`${APP_URL}/?dl=student&id=${encodeURIComponent(studentId)}`, 'Ver perfil do aluno')}
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Acesse o app para montar a ficha, rotinas e treinos desse aluno.
      </p>`)
    } else if (body?.failed_email !== undefined) {
      // ── Falha: tentativa de vínculo não concluída. O e-mail digitado só aparece escapado,
      // e só se tiver formato de e-mail; o aviso vai para o próprio personal que tentou. ──
      const raw = String(body.failed_email ?? '').trim().slice(0, 254)
      const shownEmail = EMAIL_RE.test(raw) ? raw : '(e-mail inválido)'
      const reason = (body.reason === 'wrong_role' || body.reason === 'link_error') ? body.reason : 'not_found'
      subject = 'Falha ao vincular aluno — PersonalPro'
      html = emailShell('#FF6B6B', '#FFA94D', '⚠️', 'Não foi possível vincular esse aluno', '#FFA94D', `
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1.25rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${escHtml(personal.name || 'Personal')}</strong>! ${escHtml(FAILURE_MESSAGES[reason])}
      </p>
      <div style="background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:.82rem;color:#8f9ab2">✉️ E-mail usado na tentativa: ${escHtml(shownEmail)}</div>
      </div>
      ${ctaButtonHTML(APP_URL, 'Abrir o PersonalPro')}
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Confira o e-mail digitado e tente novamente pelo app.
      </p>`)
    } else {
      return json(400, { error: 'invalid_request' })
    }

    const emailId = await sendEmail(personal.email, subject, html, TAG)
    if (!emailId) return json(502, { error: 'email_failed' })
    console.log(`[${TAG}] vínculo enviado`, { email_id: emailId, personal_id: personal.id, student_id: body?.student_id ?? null })
    return json(200, { ok: true })
  } catch (err) {
    console.error(`[${TAG}] erro inesperado:`, (err as Error)?.name)
    return json(500, { error: 'internal_error' })
  }
})
