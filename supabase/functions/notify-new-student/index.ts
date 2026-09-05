import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FAILURE_MESSAGES: Record<string, (email: string) => string> = {
  not_found: (email) =>
    `Tentativa de vincular aluno com o e-mail ${email} falhou — verifique se esse aluno já criou uma conta no PersonalPro.`,
  wrong_role: (email) =>
    `O e-mail ${email} pertence a uma conta de personal trainer, não de aluno — não foi possível vincular esse e-mail como aluno.`,
  link_error: (email) =>
    `Não foi possível concluir o vínculo com o aluno de e-mail ${email} devido a um erro técnico. Tente novamente em instantes.`,
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Cliente com o token do chamador, só para identificá-lo via auth.getUser()
    const sbAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await sbAuth.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { student_id, failed_email, reason } = await req.json()

    if (!student_id && !failed_email) {
      return new Response(JSON.stringify({ error: 'student_id or failed_email is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Supabase client com service role para ler profiles e validar o vínculo personal↔aluno
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // O chamador precisa ser um personal — usado tanto no aviso de sucesso quanto
    // no de falha (aqui não há vínculo em personal_students para validar quando falha).
    const { data: personalProfile, error: personalErr } = await sb
      .from('profiles')
      .select('email, name, role')
      .eq('id', user.id)
      .maybeSingle()

    if (personalErr || !personalProfile?.email) {
      console.error('[notify-new-student] personal não encontrado:', personalErr)
      return new Response(JSON.stringify({ error: 'Personal email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (personalProfile.role !== 'personal') {
      console.error('[notify-new-student] chamador não é personal:', user.id)
      return new Response(JSON.stringify({ error: 'Only personal accounts can trigger this notification' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let subject: string
    let html: string

    if (student_id) {
      // ── Modo sucesso: aluno vinculado ──
      // O chamador precisa ser o personal com vínculo ativo recém-criado para esse aluno —
      // nunca um terceiro, e nunca sem o vínculo realmente existir.
      const { data: link, error: linkErr } = await sb
        .from('personal_students')
        .select('id')
        .eq('personal_id', user.id)
        .eq('student_id', student_id)
        .eq('active', true)
        .maybeSingle()

      if (linkErr || !link) {
        console.error('[notify-new-student] chamador sem vínculo ativo com o aluno:', user.id, student_id)
        return new Response(JSON.stringify({ error: 'Not authorized for this student' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: student, error: studentErr } = await sb
        .from('profiles').select('email, name').eq('id', student_id).maybeSingle()

      if (studentErr || !student?.email) {
        console.error('[notify-new-student] aluno não encontrado:', studentErr)
        return new Response(JSON.stringify({ error: 'Student email not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const studentName = student.name || 'Aluno'
      subject = 'Novo aluno vinculado — PersonalPro'
      html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F5F7;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#01040C;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,#567FFF 0%,#4ADE80 100%);padding:2rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">🎉</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.02em">PersonalPro</div>
    </div>
    <div style="padding:2rem">
      <h2 style="color:#4ADE80;font-size:1.1rem;margin:0 0 1rem;font-weight:700">
        Novo aluno vinculado à sua conta!
      </h2>
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1.25rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${personalProfile.name || 'Personal'}</strong>! Um aluno acabou de ser vinculado à sua conta no PersonalPro:
      </p>
      <div style="background:rgba(86,115,255,.1);border:1px solid rgba(86,115,255,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:1rem;font-weight:700;color:#93AEFF;margin-bottom:.3rem">${studentName}</div>
        <div style="font-size:.82rem;color:#8f9ab2">✉️ ${student.email}</div>
      </div>
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Acesse o app para montar a ficha, rotinas e treinos desse aluno.
      </p>
    </div>
    <div style="padding:1rem 2rem;border-top:1px solid rgba(144,158,186,.1);text-align:center">
      <p style="color:#4a5269;font-size:.75rem;margin:0">
        Você recebeu este e-mail porque usa o PersonalPro como personal trainer.
      </p>
    </div>
  </div>
</body>
</html>`
    } else {
      // ── Modo falha: tentativa de vínculo não concluída ──
      const normalizedReason = (reason === 'wrong_role' || reason === 'link_error') ? reason : 'not_found'
      const message = FAILURE_MESSAGES[normalizedReason](failed_email)
      subject = 'Falha ao vincular aluno — PersonalPro'
      html = `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#F4F5F7;font-family:system-ui,-apple-system,sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#01040C;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.35)">
    <div style="background:linear-gradient(135deg,#FF6B6B 0%,#FFA94D 100%);padding:2rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.5rem">⚠️</div>
      <div style="font-size:1.3rem;font-weight:800;color:#fff;letter-spacing:-.02em">PersonalPro</div>
    </div>
    <div style="padding:2rem">
      <h2 style="color:#FFA94D;font-size:1.1rem;margin:0 0 1rem;font-weight:700">
        Não foi possível vincular esse aluno
      </h2>
      <p style="color:#edf1fa;line-height:1.7;margin:0 0 1.25rem;font-size:.95rem">
        Olá, <strong style="color:#F7F8FB">${personalProfile.name || 'Personal'}</strong>! ${message}
      </p>
      <div style="background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.28);border-radius:14px;padding:1.1rem 1.25rem;margin-bottom:1.5rem">
        <div style="font-size:.82rem;color:#8f9ab2">✉️ E-mail usado na tentativa: ${failed_email}</div>
      </div>
      <p style="color:#8f9ab2;line-height:1.7;margin:0;font-size:.88rem">
        Confira o e-mail digitado e tente novamente pelo app.
      </p>
    </div>
    <div style="padding:1rem 2rem;border-top:1px solid rgba(144,158,186,.1);text-align:center">
      <p style="color:#4a5269;font-size:.75rem;margin:0">
        Você recebeu este e-mail porque usa o PersonalPro como personal trainer.
      </p>
    </div>
  </div>
</body>
</html>`
    }

    // Envia via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('[notify-new-student] RESEND_API_KEY não configurada')
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
        from:    'PersonalPro <aviso@notificacoes.drluangalvao.com.br>',
        to:      [personalProfile.email],
        subject,
        html,
      }),
    })

    if (!emailRes.ok) {
      const detail = await emailRes.text()
      console.error('[notify-new-student] Resend error:', detail)
      return new Response(JSON.stringify({ error: 'Email send failed', detail }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await emailRes.json()
    console.log('[notify-new-student] Email enviado:', result.id, '→', personalProfile.email)

    return new Response(JSON.stringify({ ok: true, email_id: result.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[notify-new-student] erro inesperado:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
