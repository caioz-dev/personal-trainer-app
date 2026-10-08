import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_URL   = 'https://personal-trainer-app-ten.vercel.app'
const FROM      = 'PersonalPro <aviso@notificacoes.drluangalvao.com.br>'
const RECENT_MS = 10 * 60 * 1000   // só notifica treino criado há até 10 min
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Todo texto que entra no HTML do e-mail passa por aqui
function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// Devolve o id do e-mail no Resend, ou null. Loga só status, nunca destinatário nem corpo.
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const TAG = 'notify-new-workout'
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'unauthorized' })

    // Quem chama vem só do JWT
    const sbAuth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await sbAuth.auth.getUser()
    if (!user) return json(401, { error: 'unauthorized' })

    // Do corpo, só o id do treino. Nomes, datas e e-mails vêm do banco.
    const body = await req.json().catch(() => ({}))
    const workoutId = body?.workout_id
    if (typeof workoutId !== 'string' || !UUID_RE.test(workoutId)) return json(400, { error: 'invalid_request' })

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: w } = await sb.from('workouts')
      .select('id, name, date, student_id, created_by, created_at').eq('id', workoutId).maybeSingle()
    // Só quem criou o treino notifica, e só logo depois de criar
    if (!w || w.created_by !== user.id) return json(403, { error: 'forbidden' })
    if (Date.now() - new Date(w.created_at).getTime() > RECENT_MS) return json(409, { error: 'not_recent' })

    if (w.student_id !== user.id) {
      const { data: link } = await sb.from('personal_students').select('id')
        .eq('personal_id', user.id).eq('student_id', w.student_id).eq('active', true).maybeSingle()
      if (!link) return json(403, { error: 'forbidden' })
    }

    const [{ data: student }, { data: personal }] = await Promise.all([
      sb.from('profiles').select('name, email').eq('id', w.student_id).maybeSingle(),
      sb.from('profiles').select('name').eq('id', user.id).maybeSingle(),
    ])
    if (!student?.email) return json(404, { error: 'not_found' })

    const ctaUrl = `${APP_URL}/?dl=workout&id=${encodeURIComponent(w.id)}`
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F5F7;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#01040C;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,#567FFF 0%,#4ADE80 100%);padding:2rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">💪</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.02em">PersonalPro</div>
    </div>
    <div style="padding:2rem">
      <h2 style="color:#4ADE80;font-size:1.1rem;margin:0 0 1rem;font-weight:700">Novo treino disponível!</h2>
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${escHtml(student.name || 'Aluno')}</strong>!
      </p>
      <p style="color:#8f9ab2;line-height:1.7;margin:0 0 1.25rem;font-size:.9rem">
        <strong style="color:#edf1fa">${escHtml(personal?.name || 'Seu personal trainer')}</strong> cadastrou um novo treino para você:
      </p>
      <div style="background:rgba(86,115,255,.1);border:1px solid rgba(86,115,255,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:1rem;font-weight:700;color:#93AEFF;margin-bottom:.3rem">${escHtml(w.name || 'Treino sem nome')}</div>
        <div style="font-size:.82rem;color:#8f9ab2">📅 ${escHtml(fmtDate(w.date))}</div>
      </div>
      <div style="text-align:center;margin-bottom:1.5rem">
        <a href="${escHtml(ctaUrl)}" style="display:inline-block;background:#567FFF;color:#fff;font-weight:700;font-size:.9rem;text-decoration:none;padding:.75rem 1.75rem;border-radius:999px">Ver treino no app</a>
      </div>
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Acesse o app para visualizar os exercícios, cadências, cargas e iniciar seu treino.
      </p>
    </div>
    <div style="padding:1rem 2rem;border-top:1px solid rgba(144,158,186,.1);text-align:center">
      <p style="color:#4a5269;font-size:.75rem;margin:0">Você recebeu este e-mail porque seu personal trainer usa o PersonalPro.</p>
    </div>
  </div>
</body>
</html>`

    const emailId = await sendEmail(student.email, 'Novo treino disponível — PersonalPro', html, TAG)
    if (!emailId) return json(502, { error: 'email_failed' })
    console.log(`[${TAG}] enviado`, { email_id: emailId, workout_id: w.id, student_id: w.student_id })
    return json(200, { ok: true })
  } catch (err) {
    console.error(`[${TAG}] erro inesperado:`, (err as Error)?.name)
    return json(500, { error: 'internal_error' })
  }
})
