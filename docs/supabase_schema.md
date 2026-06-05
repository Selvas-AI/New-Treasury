# Supabase 테이블 스키마

> 이 문서는 프로젝트에서 사용하는 Supabase 테이블의 DDL 및 설계 의도를 기록합니다.

---

## 기존 테이블 (요약)

| 테이블 | 설명 |
|--------|------|
| `access_codes` | 유저 인증 코드 (id = UUID, role, company, label 등) |
| `daily` | 운전자금 일별 잔고 |
| `investments` | 운용자금 + 국채 |
| `loans` | 차입금 |
| `equities` | 지분투자 날짜별 시세 |
| `issue_comments` | 이슈 스레드 댓글 |

---

## user_table_views

유저별 테이블 뷰 설정(컬럼 가시성, 정렬 상태)을 Supabase에 영구 저장하는 테이블.
`sb_id` + `table_id` 조합이 Unique → Upsert로 단일 row 관리.

### 컬럼 정의

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | `uuid` | PK, default `gen_random_uuid()` | 행 식별자 |
| `sb_id` | `uuid` | NOT NULL, FK → `access_codes(id)` | 유저 식별 (TreasuryUser.sb_id) |
| `table_id` | `text` | NOT NULL | 테이블 식별자 (예: `'loans_table'`, `'equity_table'`) |
| `view_state` | `jsonb` | NOT NULL | 아래 ViewState JSON 구조 참조 |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | 마지막 저장 시각 |

**Unique 제약**: `(sb_id, table_id)` — 유저 1명 × 테이블 1개 = row 1개

### view_state JSON 구조

```jsonc
{
  "visibleColumns": ["company", "bank", "amount", "rate", "maturity"],
  "sortBy": { "key": "maturity", "dir": "asc" }
  // sortBy가 없으면 null
}
```

### DDL (Supabase SQL Editor에서 실행)

```sql
create table if not exists public.user_table_views (
  id          uuid        primary key default gen_random_uuid(),
  sb_id       uuid        not null references public.access_codes(id) on delete cascade,
  table_id    text        not null,
  view_state  jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),

  constraint user_table_views_unique unique (sb_id, table_id)
);

-- 유저별 조회 성능
create index if not exists idx_user_table_views_sb_id
  on public.user_table_views (sb_id);

-- RLS: 본인 row만 읽기/쓰기 (access_codes 기반 인증 사용 시 service role key로 우회 가능)
alter table public.user_table_views enable row level security;

-- 정책: sb_id 일치하는 row만 허용
-- (현재 프로젝트는 anon key + access_codes 자체 인증 사용 → 아래 정책 대신 service role key 사용 권장)
-- create policy "own rows only" on public.user_table_views
--   using (sb_id = auth.uid()::uuid);
```

> **RLS 주의**: 현재 프로젝트는 Supabase Auth를 사용하지 않고 `access_codes` 테이블로 자체 인증합니다.
> RLS를 활성화하면 anon key로 INSERT/SELECT가 차단될 수 있으므로, **RLS를 비활성화하거나**
> `service_role` 키를 사용하는 서버사이드 함수를 거치는 방식을 권장합니다.
> 보안이 필요하다면 Supabase Auth로 마이그레이션 후 RLS 정책을 추가하세요.

---

## 관련 Hook

- `src/hooks/useTableSettings.ts` — 위 테이블을 읽고 Upsert하는 훅
- `src/components/common/NotionTable.tsx` — 이 훅을 소비하는 테이블 컴포넌트

---

## Phase 2 신규 테이블 (2026-06-05)

전체 DDL: `docs/supabase_policy_tables.sql`

### policy_meetings — 자금운용위원회 회의

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `title` | text | 예: '2026년 1차 정책회의' |
| `meeting_type` | text | '정책회의'(반기) \| '운영회의'(분기) |
| `held_at` | date | 개최일 |
| `created_by` | text | 등록자 label |
| `created_at` | timestamptz | |

### policy_decisions — 의결사항

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `meeting_id` | uuid FK → policy_meetings | CASCADE DELETE |
| `company` | text | 셀바스에이아이 \| 셀바스헬스케어 \| 메디아나 |
| `title` | text | 안건명 |
| `decision` | text | 결정내용 |
| `owner` | text | 담당자 |
| `due_date` | date | 이행 기한 |
| `status` | text | 'pending' \| 'in_progress' \| 'completed' |
| `created_at` | timestamptz | |

### policy_params — 정책 파라미터 (법인별 Key-Value)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `company` | text | 법인명 |
| `param_key` | text | 파라미터 키 |
| `param_value` | numeric | 숫자값 |
| `param_text` | text | 텍스트값 |
| `updated_by` | text | 수정자 |
| `updated_at` | timestamptz | |

**UNIQUE**: `(company, param_key)` — Upsert로 관리

주요 param_key 목록: `docs/hooks/README.md` → usePolicyParams 섹션 참조

### policy_bank_limits — 거래 금융기관 한도 (규정 §9)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid PK | |
| `company` | text | 법인명 |
| `bank_name` | text | 금융기관명 (investments.bank 와 매핑) |
| `bank_type` | text | '은행' \| '증권사' \| '보험' \| '기타' |
| `limit_pct` | numeric | 한도 비율 (%, 기본 30) |
| `limit_amt` | numeric | 한도 금액 (원, 직접 지정 시 우선 적용) |
| `note` | text | 비고 |
| `updated_by` | text | 수정자 |
| `updated_at` | timestamptz | |

**UNIQUE**: `(company, bank_name)` — Upsert로 관리  
훅: `usePolicyBankLimits` / UI: `BankLimitsTab.tsx` → PolicyPage "🏦 기관한도" 탭

---

### 후속조치 스레드

별도 테이블 없음. 기존 `issue_comments` 재활용:
- `issue_key = 'policy_{decision_id}'`
- `company` = 해당 의결사항의 법인
- 훅: `usePolicyThreads` (issue_key LIKE 'policy_%' 로 조회)
