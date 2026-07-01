// admin-reset-password — master 전용 사용자 비밀번호 초기화
//
// Supabase Auth Admin API(auth.admin.updateUserById)는 service_role 키가 필요해
// 클라이언트(anon 키)에서 직접 호출할 수 없다. 이 Edge Function이 service_role로만
// 서버 사이드에서 실행되며, 호출자가 실제로 master 역할인지 매 요청 검증한다.
//
// 배포:
//   supabase functions deploy admin-reset-password
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<프로젝트 service_role 키>
// (SUPABASE_URL / SUPABASE_ANON_KEY는 Edge Function 런타임에 기본 주입됨)
//
// 요청: POST { targetEmail: string }
// 응답: { ok: true } | { error: string }

import { createClient } from 'jsr:@supabase/supabase-js@2'

const DEFAULT_TEMP_PASSWORD = 'selvas11@'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: '인증 정보가 없습니다.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1) 호출자 신원 확인 (호출자 자신의 access_token으로 getUser)
    const callerToken = authHeader.replace('Bearer ', '')
    const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken)
    if (callerErr || !callerData.user?.email) {
      return json({ error: '유효하지 않은 세션입니다.' }, 401)
    }

    // 2) 호출자가 master 역할인지 treasury_users에서 확인
    const { data: callerProfile, error: profileErr } = await admin
      .from('treasury_users').select('role, is_active')
      .eq('email', callerData.user.email.toLowerCase()).single()
    if (profileErr || !callerProfile || callerProfile.role !== 'master' || !callerProfile.is_active) {
      return json({ error: '마스터 권한이 필요합니다.' }, 403)
    }

    // 3) 대상 사용자 조회
    const body = await req.json().catch(() => ({}))
    const targetEmail = String(body.targetEmail ?? '').trim().toLowerCase()
    if (!targetEmail) return json({ error: 'targetEmail이 필요합니다.' }, 400)

    const { data: targetProfile, error: targetErr } = await admin
      .from('treasury_users').select('id, email').eq('email', targetEmail).single()
    if (targetErr || !targetProfile) return json({ error: '대상 사용자를 찾을 수 없습니다.' }, 404)

    // 4) Auth 비밀번호를 임시 비밀번호로 초기화
    const { error: updateErr } = await admin.auth.admin.updateUserById(targetProfile.id, {
      password: DEFAULT_TEMP_PASSWORD,
    })
    if (updateErr) return json({ error: `비밀번호 초기화 실패: ${updateErr.message}` }, 500)

    // 5) 다음 로그인 시 강제 변경되도록 플래그 설정
    const { error: flagErr } = await admin
      .from('treasury_users').update({ must_change_password: true }).eq('email', targetEmail)
    if (flagErr) return json({ error: `플래그 갱신 실패: ${flagErr.message}` }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '알 수 없는 오류' }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
