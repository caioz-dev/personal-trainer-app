import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { student_id, routine_name, start_date, end_date, personal_name } = await req.json()

    if (!student_id) {
      return new Response(JSON.stringify({ error: 'student_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Supabase client com service role para ler a tabela profiles
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Busca email e nome do aluno
    const { data: student, error: studentErr } = await sb
      .from('profiles')
      .select('email, name')
      .eq('id', student_id)
      .maybeSingle()

    if (studentErr || !student?.email) {
      console.error('[notify-new-routine] aluno não encontrado:', studentErr)
      return new Response(JSON.stringify({ error: 'Student email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Formata YYYY-MM-DD → DD/MM/AAAA
    const fmt = (dateStr: string | null): string => {
      if (!dateStr) return ''
      const [y, m, d] = dateStr.split('-')
      return `${d}/${m}/${y}`
    }

    const rName = routine_name || 'Rotina sem nome'
    const pName = personal_name || 'Seu personal trainer'

    const startFmt = fmt(start_date)
    const endFmt   = fmt(end_date)
    const periodHTML = startFmt
      ? `<div style="font-size:.82rem;color:#8f9ab2">📅 Vigência: ${startFmt}${endFmt ? ` até ${endFmt}` : ''}</div>`
      : ''

    const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F5F7;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#01040C;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,#567FFF 0%,#4ADE80 100%);padding:2rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">🗓️</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.02em">PersonalPro</div>
    </div>
    <div style="padding:2rem">
      <h2 style="color:#4ADE80;font-size:1.1rem;margin:0 0 1rem;font-weight:700">
        Nova rotina de treino disponível!
      </h2>
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${student.name || 'Aluno'}</strong>!
      </p>
      <p style="color:#8f9ab2;line-height:1.7;margin:0 0 1.25rem;font-size:.9rem">
        <strong style="color:#edf1fa">${pName}</strong> criou uma nova rotina de treinos para você:
      </p>
      <div style="background:rgba(86,115,255,.1);border:1px solid rgba(86,115,255,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:1rem;font-weight:700;color:#93AEFF;margin-bottom:.3rem">${rName}</div>
        ${periodHTML}
      </div>
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Acesse o app para ver os treinos da rotina, exercícios, cadências e iniciar seu treino.
      </p>
    </div>
    <div style="padding:1rem 2rem;border-top:1px solid rgba(144,158,186,.1);text-align:center">
      <p style="color:#4a5269;font-size:.75rem;margin:0">
        Você recebeu este e-mail porque seu personal trainer usa o PersonalPro.
      </p>
    </div>
  </div>
</body>
</html>`

    // Envia via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('[notify-new-routine] RESEND_API_KEY não configurada')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not set' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'PersonalPro <onboarding@resend.dev>',
        to:      [student.email],
        subject: 'Nova rotina de treino disponível — PersonalPro',
        html,
      }),
    })

    if (!emailRes.ok) {
      const detail = await emailRes.text()
      console.error('[notify-new-routine] Resend error:', detail)
      return new Response(JSON.stringify({ error: 'Email send failed', detail }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await emailRes.json()
    console.log('[notify-new-routine] Email enviado:', result.id, '→', student.email)

    return new Response(JSON.stringify({ ok: true, email_id: result.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-new-routine] erro inesperado:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
