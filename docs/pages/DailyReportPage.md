# DailyReportPage — 자금일보

**파일**: `src/pages/DailyReportPage.tsx`  
**라우트**: `/daily-report/:company?/:date?`  
**최종 업데이트**: 2026-06-12  
**개발 상태**: 🟢 S1~S6 전 단계 구현 완료 / CMS 다중 PDF 대사 기능 포함

---

## 0. 날짜 모델 (⭐ 최우선 규칙)

### 핵심 전제 — `daily` 테이블 날짜 규칙

> **`daily` 테이블의 날짜 `D` 레코드 = 담당자가 `D`일 아침에 입력한 값 = 전일(`D-1` 영업일) 23:59:59까지의 최종 잔액 (= 전일 마감)**

담당자가 오늘(6/10) 입력한 `daily[6/10]`은 **6/10 현재 잔액이 아니라 6/9 마감 잔액**이다.
(자금담당자는 출근 후 전일 거래내역을 정리하여 전일 마감잔액을 당일자로 기록)

### 용어 정의

| 용어 | 변수 | 예 (오늘=6/10) | 의미 |
|------|------|----------------|------|
| **작성일** | `selectedDate` (picker) | 6/10 | 담당자가 일보를 쓰는 날 (기본값=오늘) |
| **보고 대상일** | `reportDate = prevBizDay(selectedDate)` | 6/9 | 입·출금을 정리하는 날 (직전영업일) |

### 자금현황 표 — 현금 (`daily` 테이블)

| 컬럼 | 데이터 출처 | 표기 라벨 | 의미 |
|------|------------|----------|------|
| **기초잔액** | `daily[reportDate]` = `daily[6/9]` (직전영업일 입력) | **6/9** | 6/9 시작 잔액 (= 6/8 마감) |
| **마감잔액** | `daily[selectedDate]` = `daily[6/10]` (오늘 입력) | **6/9** | 6/9 마감 잔액 |

→ **두 컬럼 라벨 모두 보고 대상일(6/9)**. 데이터는 각각 `daily[6/9]`, `daily[6/10]`.

### 자금현황 표 — 지분·국채 (거래일 = 종가 날짜)

| 컬럼 | 데이터 | 의미 |
|------|--------|------|
| **기초** | `prevBizDay(reportDate)` 종가 = 6/8 종가 | 6/9 시작 평가액 |
| **마감** | `reportDate` 종가 = 6/9 종가 | 6/9 마감 평가액 |
| 변동분 | 6/9 일간 변동 | 입금(평가이익)/출금(평가손실) **자동 기재** (memo `@auto:` / `@auto:bond:`) |

### 검증식
```
입금합계 − 출금합계 = 마감잔액(daily[selectedDate]) − 기초잔액(daily[reportDate])
```

### 영업일 처리
- `prevBizDay(d)` : 주말(토·일) 건너뛰어 직전 영업일 반환 (예: 월요일 → 직전 금요일)
- 캘린더(BusinessDatePicker): 일~토 배열, 주말 비활성, 작성일 상한 = 오늘(`snapToBizDay(today)`)
- 녹색 dot = 해당 작성일의 보고 대상일(`prevBizDay`)에 운전자금 데이터 존재

### 리포트 키
- `daily_reports.date` = **작성일(selectedDate)** — "오늘자(6/10) 자금일보"
- 마감잔액 `daily[selectedDate]`를 확정(confirm)하는 보고서

---

## 1. 개요

매 영업일 법인별 자금 담당자가 운전자금·운용자금 변동 내역을 입력하고,
입출금 항목 합계가 검증되면 결재선을 통해 승인받는 **공식 자금 일일 보고서** 시스템.

### 데이터 반영 정책 — C안 (확정)

| 단계 | 상태 | 대시보드 반영 | 공식 확정 |
|------|------|-------------|-----------|
| 입력 저장 | `draft` | ✅ 즉시 임시 반영 | ❌ |
| 상신 완료 | `submitted` | ✅ 임시 반영 유지 | ❌ |
| 승인 완료 | `approved` | ✅ **확정 반영** | ✅ |

> `daily` 테이블의 `confirmed` 플래그로 임시/확정 구분.  
> 대시보드는 임시 데이터도 즉시 표시하되, 미승인 데이터에는 ⚠ 표시.

---

## 2. 사용자 권한

| 역할 | 가능 동작 |
|------|-----------|
| `company` (담당자) | 자사 일보 작성·임시저장·상신 |
| `master` / 결재권자 | 상신된 일보 승인·반려, 결재선 관리 |
| `ceo` | 전 법인 일보 열람만 |

---

## 3. 결재선 (Approval Line)

### 기본 구조
- **Default**: 담당자(step=0) → 팀장(step=1)
- **유연 확장**: step=2, 3 … 추가 가능 (`policy_approvers` 테이블 또는 `daily_reports.approval_config` JSONB)

### 결재 상태 흐름
```
draft ──[상신]──► submitted ──[승인]──► approved
                      │
                   [반려]──► rejected ──[재작성]──► draft
```

### 결재선 관리 UI
- master 전용 설정 화면에서 법인별 결재 단계·결재권자 추가/삭제
- 각 step: `{ step: number, role_label: string, approver_code: string }`
- `daily_report_approval_config` 테이블 (company + step unique)

---

## 4. 화면 구성

### 4-1. 헤더 바
```
📄 자금일보   [셀바스에이아이 ▼]   ◀ 2026-06-09 ▶   [임시저장]  [상신 →]
                                                    상태: ● 작성 중
```
- 법인 선택: company 권한은 자사 고정
- 날짜 선택: 오늘 기본, 과거 조회 가능 (승인된 날짜는 읽기 전용)
- 상태 배지: draft(회색) / submitted(주황) / approved(초록) / rejected(빨강)

### 4-2. 자금현황 요약 테이블 (메인 상단)

| 구분 | 전일잔액 | 입금액 | 출금액 | 당일잔액 | 원화환산 |
|------|---------|-------|-------|---------|---------|
| **운전자금** | | | | | |
| 요구불(KRW) | | | | | — |
| 정기예금(KRW) | | | | | — |
| MMDA(KRW) | | | | | — |
| USD | | | | | ○○억 |
| EUR | | | | | ○○억 |
| JPY | | | | | ○○억 |
| **운용자금** | | | | | |
| 정기예금 | | | | | |
| MMF | | | | | |
| RP | | | | | |
| 기타 | | | | | |
| **차입금** | | | | | |
| 단기 | | | | | |
| 장기 | | | | | |

- 전일잔액: `daily` + `investments` 테이블에서 자동 집계
- 당일잔액: 담당자 직접 입력 (운전자금은 Input 페이지 연동 자동입력 가능)
- 입금액/출금액: 하단 내역 합산 자동 계산
- 외화 원화환산: 당일 GAS 환율 자동 적용 + 수동 override 가능

### 4-3. 입금/출금 내역 섹션 (좌우 2분할)

#### 입금 카테고리
| 코드 | 라벨 | 연동 |
|------|------|------|
| `ar_collection` | 매출채권 회수 | — |
| `other_receivable` | 미수금 회수 | — |
| `govt_fund` | 국책자금 회수 | — |
| `advance_in` | 선수금 입금 | — |
| `invest_return` | 투자(운용)금 회수 | 🔗 운용자금/지분 선택 팝업 |
| `loan_drawdown` | 차입금 실행 | 🔗 차입금 신규 입력 팝업 |
| `other_in` | 기타 | 💬 스레드 팝업 |

#### 출금 카테고리
| 코드 | 라벨 | 연동 |
|------|------|------|
| `ap_payment` | 미지급금 지급 | — |
| `advance_out` | 선급금 지급 | — |
| `invest_execute` | 투자(운용)집행 | 🔗 운용자금/지분 신규 입력 팝업 |
| `loan_repayment` | 차입금 상환 | 🔗 차입금 목록 선택 팝업 |
| `other_out` | 기타 | 💬 스레드 팝업 |

#### 라인 아이템 구조
```
[항목 ▼] [금액 입력] [통화 ▼] [메모] [🔗/💬] [✕]
```

### 4-4. 검증 바 (하단 고정)
```
🔍 검증   입금 합계 55.0억  -  출금 합계 23.2억  -  잔액증감 31.8억  =  ✅ 0원
           ※ 차액이 0이 되면 [상신] 버튼 활성화
```
검증 공식: `입금합계 - 출금합계 - (당일잔액합계 - 전일잔액합계) = 0`

### 4-5. 결재선 표시 (하단)
```
결재선:   작성 홍길동 ✅ 2026-06-09 09:30
      →   팀장 김자금 ⬜ 미승인
      →   [+ 결재 단계 추가]  (master 전용)
```

---

## 5. 팝업 / 모달 목록

| 트리거 | 팝업 내용 |
|--------|-----------|
| `invest_return` 선택 | 운용자금·지분 목록 → 체크 선택 → 회수금액 입력 → 해당 레코드 `active=false` |
| `loan_drawdown` 선택 | 차입금 신규 입력 폼 (NewLoanForm) → 저장 시 `loans` 테이블 + 일보 라인 연동 |
| `invest_execute` 선택 | 운용자금 신규 입력 폼 or 지분 신규 입력 폼 탭 → 저장 시 `investments`/`equities` + 일보 라인 연동 |
| `loan_repayment` 선택 | 활성 차입금 목록 → 선택 → 상환처리 → `loans.active=false` |
| `other_in` / `other_out` 선택 | 스레드 팝업: 사유 입력 + 이전 기록 로그 표시 |
| 결재선 승인 버튼 | 코드/비밀번호 재확인 → 승인 처리 |

---

## 6. 출력 (Print / 하드카피)

- `[🖨️ 인쇄]` 버튼 → 브라우저 Print CSS 적용
- 인쇄 레이아웃: A4 가로, 자금현황 테이블 + 입출금 내역 + 결재란
- 결재란: 작성자 / 팀장 / (추가 결재자) 서명란 포함
- Phase 2: PDF 다운로드 (html2pdf or 서버사이드)

---

## 7. Sidebar 위치

```
DASHBOARD
  ⊞  통합 상황판   /dashboard
  📄  자금일보      /daily-report    ← 신규
  📋  자금정책      /policy
```

---

## 8. 관련 파일

| 파일 | 역할 |
|------|------|
| `src/pages/DailyReportPage.tsx` | 메인 페이지 |
| `src/pages/DailyReportListPage.tsx` | 일별 목록 페이지 (`/daily-report-list`) |
| `src/components/daily-report/ReportSummaryTable.tsx` | 자금현황 요약 테이블 (FX native 표시) |
| `src/components/daily-report/ItemsSection.tsx` | 입금/출금 라인 아이템 입력 |
| `src/components/daily-report/ValidationBar.tsx` | 검증 + 상신 버튼 |
| `src/components/daily-report/ApprovalLine.tsx` | 결재선 표시·승인 |
| `src/components/daily-report/ThreadPopup.tsx` | 기타 스레드 팝업 |
| `src/components/daily-report/InvestLinkPopup.tsx` | 투자 연동 팝업 |
| `src/components/daily-report/LoanLinkPopup.tsx` | 차입금 연동 팝업 |
| `src/components/daily-report/CmsVerificationModal.tsx` | CMS 잔고 PDF 대사 검증 모달 (다중 PDF) |
| `src/hooks/useDailyReport.ts` | 일보 CRUD + 결재선 설정 훅 |
| `src/hooks/useDailyReportItems.ts` | 라인 아이템 CRUD 훅 |
| `src/hooks/useDailyReportAttachments.ts` | 첨부파일(PDF) Supabase Storage CRUD 훅 |
| `src/hooks/useDailyReportSummary.ts` | 자금현황 집계 훅 (ItemSums 포함) |
| `docs/db/daily_report_tables.sql` | Supabase DDL |

---

## 9. 개발 Stage

| Stage | 내용 | 상태 |
|-------|------|------|
| **S1** | DB DDL + 라우트 + 페이지 기본 골격 | ✅ 2026-06-10 완료 |
| **S2** | 자금현황 요약 테이블 (자동 집계 + 수동 입력) | ✅ 2026-06-10 완료 |
| **S3** | 입금/출금 라인 아이템 입력 (기타 스레드 포함) | ✅ 2026-06-10 완료 |
| **S4** | 연동 팝업 (투자 회수/집행, 차입 실행/상환) | ✅ 2026-06-10 완료 |
| **S5** | 검증 로직 + 결재 워크플로우 (상신/승인/반려) | ✅ 2026-06-10 완료 |
| **S6** | 인쇄 출력 (Print CSS) | ✅ 2026-06-11 완료 |
| **S7** | PDF 첨부 업로드 + CMS 잔고 대사 검증 모달 | ✅ 2026-06-11 완료 |
| **S8** | CMS 다중 PDF 지원 + 외화 native 표시 + 무한 루프 수정 | ✅ 2026-06-12 완료 |

---

## 10. CMS 잔고 대사 검증 (CmsVerificationModal)

### 개요
Supabase Storage에 업로드된 은행 CMS 잔고 PDF와 자금일보 자금현황 항목을 1:1 대사하는 검증 모달.
자금일보 상단 첨부파일 카드의 `[대사 검증]` 버튼으로 진입.

### 다중 PDF 지원 (S8)
- 법인별로 복수의 CMS PDF를 업로드 가능; 모달 상단에 **PDF 탭** 표시
- 마운트 시 모든 PDF에서 숫자 금액 추출 → `allHits: Hit[]` (pdfIndex, fileName, page)
- 자금현황 각 항목 카드에 **크로스 PDF 매칭 결과** 자동 표시: `🟢 CMS_A.pdf p.2 에서 일치`

### 카드 클릭 → PDF 페이지 점프
```
카드 클릭 → locate(hit) → activePdf 탭 전환 + pdfPage 이동 + 추출목록 해당 금액 노란 강조
```
- 캔버스 하이라이트 미사용 (pdfjs span 분리로 신뢰도 낮음)
- 좌측 PDF 텍스트 레이어는 드래그 선택 가능 (`cursor: text`)

### 상태 구조 (VState)
```typescript
type VState = {
  done: boolean       // 대사 완료 여부
  memo: string        // 담당자 메모
  editMemo: boolean   // 메모 편집 중
  collapsed: boolean  // 완료 카드 접기
  source: string      // 확인한 PDF 파일명
}
// localStorage 키: cms_verify_{company}_{reportDate}
```

### 외화 항목 처리
- FX 항목 카드: 원화 환산값이 아닌 **외화 원단위 금액**으로 매칭 시도
- PDF에서 외화 금액 직접 추출되지 않는 경우 메모로 수동 확인

---

## 11. 자금현황 외화 native 표시

### 배경
기존: FX 행 입금/출금 컬럼이 KRW 환산 금액으로 표시 → `전일잔액(USD) + 입금(KRW) − 출금(KRW) ≠ 마감잔액(USD)` 불일치

### 해결 (S8)
- `ItemSums.byAccount`: `{ inKrw, outKrw, inRaw, outRaw }` — 원화/원단위 이중 추적
- `ReportSummaryTable.tsx` `FxRow`: 입금/출금 컬럼 → `fmtFx(inRaw, code)` (외화 단위)
- 원화환산 컬럼(마지막 열)은 `(전일잔액 + 당일잔액) ÷ 2 × 환율` 으로 참고 표시 유지

---

## 12. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-06-09 | 기획 확정 (C안 데이터 반영, 유연한 결재선), 문서 최초 작성 |
| 2026-06-10 | S1~S5 구현, 날짜 모델 재정립, BusinessDatePicker, 자동기재 로직 |
| 2026-06-11 | S6 인쇄 출력, S7 PDF 첨부 + CmsVerificationModal 기초 구현 |
| 2026-06-12 | S8 다중 PDF 탭, 크로스 PDF 매칭, 페이지 점프, 외화 native 표시, 무한 루프 수정 |
