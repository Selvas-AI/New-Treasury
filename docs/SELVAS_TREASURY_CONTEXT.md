# Selvas Treasury — 전체 개발 컨텍스트 문서
> 작성 기준: 2026-05-28 | Claude와의 개발 세션 v1~v3 누적 정리
> 이 문서는 새로운 Claude 세션에서 맥락을 빠르게 파악할 수 있도록 작성된 핸드오버 문서입니다.

---

## 1. 프로젝트 개요

### 목적
셀바스에이아이(A), 셀바스헬스케어(B), 메디아나(C) 3개 법인의 통합 자금 현황을 실시간 모니터링하고, 운전자금·운용자금·차입금·지분투자·국채를 체계적으로 관리하는 웹 애플리케이션.

### 접속 정보
- **서비스 URL**: https://treasury.selvas.com
- **GitHub Pages URL**: https://yeansoojeong.github.io/treasury/
- **GitHub 레포지토리**: https://github.com/yeansoojeong/treasury
- **구성**: 단일 HTML 파일(index.html) + CI 이미지 3개(selvasai.png, selvashealthcare.png, mediana.png)

### 기술 스택
- **프론트엔드**: HTML/CSS/Vanilla JS (단일 파일, 현재 ~10,900줄)
- **데이터베이스**: Supabase (PostgreSQL, REST API anon key)
- **외부 API 프록시**: Google Apps Script (GAS) Web App
- **배포**: GitHub Pages (정적 호스팅)
- **차트**: Chart.js (CDN)
- **아이콘**: Tabler Icons (CDN)

### 개발 환경 변경 (중요)
- **기존**: Claude.ai 웹/모바일 인터페이스에서 직접 파일 첨부/생성
- **향후**: **Windows PowerShell CLI 환경**에서 개발 예정
- Claude Code 또는 PowerShell에서 claude CLI 사용 방식으로 전환

---

## 2. 권한 체계

```
master  → 전체 3사 열람 + 편집 + 관리 메뉴 접근 가능
ceo     → 전체 3사 열람만 (편집 버튼 비활성화)
company → 자사(소속 법인)만 열람 + 편집 (타사 데이터 접근 불가)
```

- 인증 방식: Supabase `access_codes` 테이블에서 접근 코드 조회
- 로그인 후 `sessionStorage`에 `treasury_user` 키로 사용자 정보 저장
- `currentCompany` 전역 변수로 현재 선택 법인 관리
- `getFiltered(table)` 함수가 currentCompany 기준으로 자동 필터링

---

## 3. Supabase 테이블 전체 구조

### 3-1. daily (운전자금 일별 잔고)
```
id            uuid  PK
company       text  법인명
date          text  기준일 YYYY-MM-DD
writer        text  작성자
krw_demand    numeric 보통예금/CMA (원화)
krw_govt      numeric 국책자금 (원화)
krw_mmda      numeric 증권 예수금 (원화)
fx_usd        numeric USD 잔고
fx_eur        numeric EUR 잔고
fx_jpy        numeric JPY 잔고
fx_gbp        numeric GBP 잔고
fx_cny        numeric CNY 잔고
fx_krw        numeric 외화 원화환산 합계
memo          text  비고
```

### 3-2. investments (운용자금 + 국채/채권)
```
id              uuid    PK
company         text    법인명
bank            text    금융기관명 또는 채권명(국채)
product         text    상품유형 (정기예금, RP, MMF, 국채 등)
currency        text    통화
amount          numeric 금액/평가금액
available       text    가용/불가용
rate            numeric 수익률(%)
start           text    시작일 YYYY-MM-DD
start_date      text    (legacy)
maturity        text    만기일 YYYY-MM-DD
active          boolean 활성 여부
bondName        text    채권명 (국채 전용)
bondTicker      text    ISIN 코드 (국채 전용)
bondQty         numeric 보유 좌수 (국채 전용)
bondPrice       numeric 기준가 1좌당 (국채 전용)
priceDate       text    시세 기준일 (국채 전용, YYYY-MM-DD)
migratedFrom    text    이전 출처 표시
acquisition_cost numeric 취득가액 총액 ← v2.2에서 추가됨
```

**국채 평가금액 계산 공식**: `좌수 × (기준가 ÷ 10)`
- 공공데이터 채권 API의 기준가(clprPrc)는 액면 10,000원 기준 호가
- 실제 1좌당 가격 = 기준가 ÷ 10 (예: 기준가 7,408원 → 1좌 = 740.8원)

### 3-3. loans (차입금)
```
id          uuid    PK
company     text    법인명
lender      text    금융기관
type        text    차입유형
currency    text    통화
amount      numeric 차입금액
rate        numeric 금리(%)
start_date  text    차입일 YYYY-MM-DD
maturity    text    만기일 YYYY-MM-DD
active      boolean 활성 여부
```

### 3-4. equities (지분투자 날짜별 시세)
```
id               uuid    PK
company          text    보유 법인
name             text    종목명
ticker           text    KRX 종목코드 (6자리)
market           text    KOSDAQ/KOSPI/비상장
purpose          text    투자목적
available        text    가용/불가용 (처분 제한 여부)
shares           numeric 보유 주수
price            numeric 주가(원) 기준일 기준
total_value      numeric 평가금액 (shares × price)
date             text    기준일 YYYY-MM-DD (날짜별 레코드)
acquisition_cost numeric 취득가액 총액 ← v2.2에서 추가됨
```
- 같은 종목의 날짜별 레코드가 쌓임 → 히스토리 추이 차트에 활용
- 동일 법인+종목명+날짜 조합 시 upsert(덮어쓰기)

### 3-5. issue_comments (이슈 코멘트 스레드)
```
id          uuid        PK
issue_key   text        이슈 식별자
                        - loan_{uuid} : 차입금 만기 이슈
                        - equity_{종목명} : 주가 미갱신
                        - input_daily : 운전자금 미입력
company     text        법인명
user_label  text        작성자 표시명
user_role   text        권한 (master/ceo/company)
body        text        코멘트 본문
status      text        open/review/done
issue_title text        이슈 제목
issue_desc  text        이슈 설명
created_at  timestamptz 작성 시각
```

**이슈 키 안정화 이력**: 초기에는 `loan_{id}_D77` 처럼 D-day가 포함되어 매일 키가 바뀌는 문제 → `loan_{id}` 형태로 고정. DB 마이그레이션 SQL:
```sql
UPDATE issue_comments
SET issue_key = regexp_replace(issue_key, '_D\d+$', '')
WHERE issue_key ~ '_D\d+$';
```

### 3-6. access_codes (사용자 인증)
```
id           uuid    PK
access_code  text    로그인 코드
role         text    master/ceo/company
company      text    법인명 (company 역할만)
label        text    사용자 표시명
is_active    boolean 활성 여부
```

### 3-7. price_history (시세 이력)
```
id    uuid    PK
key   text    종목 식별 키 (equity_{company}_{name}, bond_{ISIN})
date  text    기준일 YYYY-MM-DD
value numeric 시세
```

### 3-8. 추가 예정 테이블 (Phase 2 이후)
- `policies` : 자금정책 문서 관리
- `policy_checks` : 정책 준수 체크리스트
- `reports` : 자금일보
- `approvals` : 결재 이력
- `cashflow_plan` : 자금수지 계획
- `receivables` : 채권회수 현황

---

## 4. GAS (Google Apps Script) 구조

### 배포 정보
- **파일**: `GAS_코드_v3.gs`
- **스크립트 속성 (필수)**:
  - `STOCK_API_KEY`: 공공데이터포털 주식 시세 API 인증키
  - `BOND_API_KEY`: 공공데이터포털 채권 시세 API 인증키 (동일 키 사용 가능)
  - `SUPABASE_KEY`: Supabase anon key (운전자금 미입력 메일 발송용)
- **발신 이메일**: `matthew.y.jeong@selvas.com` (Gmail에 등록된 발신자)

### API 우선순위
```
주가 조회:
  1순위: 공공데이터포털 GetStockSecuritiesInfoService (승인 후)
  2순위: 네이버 m.stock.naver.com/api/stock/{code}/basic
  3순위: Yahoo Finance (최후 폴백)

채권 시세:
  공공데이터포털 GetBondSecuritiesInfoService
  - basDt 파라미터로 특정 날짜 조회 가능
  - T+1 제공: 당일/전일 데이터는 없음 (익영업일 13시 이후 업데이트)
  - basDt 미지정 시 최근 10건 내림차순으로 가장 최근 유효 데이터 반환

환율:
  네이버 금융 (하나은행 기준, 5통화: USD/EUR/JPY/GBP/CNY)
```

### 자동 시세 조회 스케줄러
- 시각: 09:15 / 12:15 / 15:45 (영업일만)
- 탑바 ON/OFF 토글 (`localStorage: auto_price_on`)
- 공휴일·주말 자동 제외

### 운전자금 미입력 메일 알림
- 함수: `checkAndSendDailyAlert()`
- 트리거: 매일 UTC 04:00 = KST 13:00
- 영업일(주말·공휴일 제외) 13시까지 미입력 법인에 자동 발송
- 법인별 수신자: `RECIPIENTS` 객체 (쉼표로 복수 수신자 지원)
- 중복 발송 방지: `PropertiesService`에 오늘 발송 여부 저장
- 발송 URL: https://treasury.selvas.com

---

## 5. 메뉴 구조 및 페이지 ID

```
사이드바 메뉴                    page ID
─────────────────────────────────────────
통합 상황판 (대시보드)           page-dashboard
운전자금 입력                   page-input
운용자금 (단기투자)              page-invest
차입금 (대출)                   page-loans
지분/장기투자 관리               page-equity
자금 변동 이력                  page-history
이슈 이력                       page-issue-history
환율 현황                       page-fx
─── 관리 (master만) ───
코드 변경                       page-admin-mycode
사용자 관리                     page-admin-users
데이터 관리                     page-admin-data
─── 예약 (미구현) ───
자금정책                        page-policy
자금일보                        page-report
```

---

## 6. 핵심 JS 구조 및 주요 함수

### 전역 변수
```javascript
let currentCompany = '셀바스에이아이'; // 현재 선택 법인
let currentUser = null;               // 로그인 사용자 정보
const _cache = {};                    // Supabase 데이터 메모리 캐시
const TABLE_MAP = {                   // 로컬키 → Supabase 테이블명
  daily, investments, loans, equities, price_history
};
let mainChartObj = null;              // 현금흐름 추이 Chart.js 객체
let equityChartObj = null;            // 지분/장기투자 Chart.js 객체
var _ihIds = [];                      // 이슈 이력 수정/삭제 UUID 매핑 배열
var _acqBulkData = null;              // 취득가액 일괄반영 모달 데이터
```

### 핵심 함수 목록
```javascript
// 인증
doLogin()                    // 로그인 처리 (Supabase access_codes 조회)
applyAccessControl(user)     // 로그인 성공 후 권한 적용 + 화면 초기화

// 데이터
sbFetch(path, options)       // Supabase REST API 헬퍼
getFiltered(table)           // currentCompany 기준 필터링된 캐시 반환
DB.get/load/append/updateOne/deleteOne  // DB CRUD 레이어

// 날짜/계산
normDate(d)                  // YYYYMMDD → YYYY-MM-DD 정규화
fmtKRW(n)                    // 원화 억/만 단위 포맷
calcKRW(amount, currency)    // 외화 → 원화 환산
todayIsBusinessDay()         // 오늘 영업일 여부 체크

// 국채 관련
getLatestBonds(investments)       // 국채 종목별 최신 날짜 1건 반환
getLatestInvestments(investments) // 비국채 + 국채 최신 1건 반환

// 이슈
makeIssueKey(type, id)       // 이슈 식별자 생성 (D-day 제외 안정화)
_ihIds[]                     // 이슈 이력 버튼 UUID 배열
_ihEdit(i) / _ihDel(i)       // 이슈 이력 수정/삭제 핸들러 (인덱스 방식)

// 수익률
_calcReturn(evalAmt, acqCost)     // 수익률 % 계산
_returnBadgeStyle(ret)            // 호가창 스타일 배지 (상승=빨강, 하락=파랑)
calcEquityReturn()                // 주식 폼 수익률 실시간 갱신
calcBondEquityReturn()            // 국채 폼 수익률 실시간 갱신
_showAcqBulkConfirm(name, cost, recs, table)  // 과거이력 일괄반영 모달

// 차트
updateMainChart(records)          // 현금흐름 추이 차트 (날짜별 계산)
updateEquityChart(allEqRecords)   // 지분+국채 2데이터셋 차트
onEquityFilterChange()            // 드롭다운 필터 변경 핸들러

// 팝업
_showUpdatePopupIfNeeded()        // v2.1 업데이트 팝업
_showAcqPopupIfNeeded()           // 취득가액 기능 안내 팝업 (v2.2)
closeAcqPopup()                   // 팝업 닫기 (계정별 localStorage)
```

---

## 7. 지분/장기투자 메뉴 상세 구조

### 탭 구성
```
지분 (주식) 탭  →  equities 테이블
국채 / 채권 탭  →  investments 테이블 (product='국채')
비상장 / 기타   →  equities 테이블 (market='비상장')
```

### 지분(주식) 탭
- 종목 클릭 → `equity-history-panel` 펼쳐짐 (날짜별 시세 이력)
- 자동 시세 조회: GAS → 네이버/공공데이터 API
- 전체 종목 시세 일괄 갱신 버튼

### 국채/채권 탭
- 종목 목록: 종목별 최신 날짜 1행씩 표시 (`getLatestBonds()` 활용)
- 행 클릭 → `bond-history-panel` 펼쳐짐
- 히스토리 패널에서:
  - 날짜 선택 → 시세 조회 버튼 → GAS에서 ISIN 기준 조회 → 기준가 자동입력
  - 또는 기준가 직접 입력 → 즉시 평가금액 계산
  - 저장 시 같은 날짜 레코드 있으면 upsert, 없으면 새 레코드 추가
- 전체 시세 갱신: `runBulkBondRefresh()` → basDt 미지정으로 최근 유효 데이터 자동 조회

### 취득가액 기능 (v2.2 신규)
- 입력 필드: `e-acq-cost` (주식), `b-acq-cost` (국채)
- 저장 시 `acquisition_cost` 컬럼에 저장
- 평가금액 옆에 수익률 배지 실시간 표시 (상승=빨강, 하락=파랑)
- 저장 완료 0.4초 후 과거이력 일괄반영 모달 자동 표시
- 모달 버튼:
  - **이번만 적용**: 현재 레코드만
  - **전체 이력에 일괄 반영**: 같은 종목/채권 모든 이력에 적용

---

## 8. 통합 상황판 구조

### 워터폴 자금흐름
```
운전자금(가용) + 운용자금(가용) - 차입금 = 순현금 포지션
                                         + 불가용 자산
```

### KPI 카드
- 가용자금 합계, 순현금 포지션, 불가용 자산
- 운전자금 상세: 보통예금/국책/증권예수금
- 운용자금 상세: 국채 제외, 국채는 별도 행으로 표시
- 차입금 상세: 만기 D-day 포함

### 이슈 확인 카드
이슈 자동 감지 3종:
1. **오늘 운전자금 미입력** (영업일만, issueKey: `input_daily`)
2. **차입금 만기 D-90 이하** (issueKey: `loan_{uuid}`)
3. **지분 주가 미갱신 2일 이상** (issueKey: `equity_{종목명}`)

코멘트 스레드:
- 상태: open(미조치) / review(검토중) / done(완료)
- 완료 처리된 이슈는 이슈 카드에서 즉시 숨김 + 배지 카운트 제외
- 배지: 로그인 계정 기준 비동기 로드 완료 후 정확한 카운트 표시
- 법인 전환 시 즉시 이전 법인 이슈 목록 초기화

### 지분/장기투자 카드
- 지분(핑크) + 국채(파랑) 영역형 그래프 (스파크라인)
- 각 종목: 평가금액 + 수익률 배지 (호가창 스타일) + 취득가액 메타 + 미니 스파크라인
- 전체/종목별 필터 드롭다운

### 현금흐름 추이 차트
- 날짜별 계산 방식: `filterHistory()`와 동일
- 국채는 `getLatestInvestments()`로 종목별 최신 1건만 합산
- 기간: 7일/30일/90일/1년

---

## 9. 주요 버그 이력 및 해결책

### 9-1. 이슈 이력 수정/삭제 버튼 미작동 (핵심 이슈)
**원인**: `innerHTML`로 버튼 삽입 시 `onclick="openIhEdit(\"uuid\")"` 형태에서 `"uuid"` 안의 따옴표가 HTML 파서에서 속성을 조기 종료시킴

**해결**: 전역 배열 `_ihIds[]`에 UUID 저장, 버튼 onclick에는 숫자 인덱스만 전달
```javascript
var _ihIds = [];
function _ihEdit(i) { if (_ihIds[i]) openIhEdit(_ihIds[i]); }
function _ihDel(i)  { if (_ihIds[i]) deleteIhComment(_ihIds[i]); }
// 버튼: onclick="_ihEdit(0)", onclick="_ihDel(1)"
```

**교훈**: `document.addEventListener('click', ...)` 전역 이벤트 위임 방식은 로그인 버튼을 포함한 전체 클릭을 가로채서 로그인 불가 장애를 유발함 → 절대 사용 금지

### 9-2. 로그인 불가 장애
**원인**: 전역 click 이벤트 리스너 추가 + openIhEdit 함수 본체 코드가 전역 스코프로 누출되어 런타임 오류 발생 → doLogin 함수 undefined

**해결**: 잔여 코드 제거 + 전역 이벤트 리스너 제거

**예방**: 새 코드 추가 시 함수 바깥에 실행 코드가 남지 않도록 중괄호 균형 확인 필수

### 9-3. 국채 날짜 형식 불일치
**원인**: GAS 채권 API가 `basDt`를 `YYYYMMDD`로 반환 → 기존 `YYYY-MM-DD` 레코드와 중복 체크 실패

**해결**:
1. GAS에서 `item.basDt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')` 추가
2. index.html에 `normDate(d)` 헬퍼 함수 추가 (방어적 변환)

### 9-4. 지분/장기투자 그래프 드롭다운 선택 시 차트 사라짐
**원인**: 드롭다운 선택 시 `onEquityFilterChange`가 equities 데이터만 `updateEquityChart`에 전달 → 국채 데이터는 investments에 있어 조회 불가

**해결**: `updateEquityChart` 내부에서 investments 국채 데이터를 직접 조회. `equityChartStock` 값(`eq_종목명`, `bond_채권명`)으로 분기 처리

### 9-5. 법인 전환 시 이슈 카드 이전 법인 내용 잔존
**원인**: `renderDashboard` 완료 후에야 이슈 카드가 갱신되어 전환 직후 이전 법인 이슈가 잠깐 표시됨

**해결**: `wfSelectCompany()` 함수 시작 시 즉시 이슈 카드 DOM 초기화

### 9-6. 운용자금 vs 자금변동이력 수치 불일치
**원인**: `updateMainChart`에서 `getFiltered('investments').filter(i => i.active)` 전체를 합산 → 국채 22개 날짜별 레코드 모두 더해짐

**해결**: `getLatestInvestments()`로 국채는 종목별 최신 1건만 사용. 날짜별 계산도 `filterHistory()`와 동일 방식으로 통일

### 9-7. 팝업 다시 보지 않기 계정 간 공유 문제
**원인**: localStorage 키가 `selvas_acq_popup_dismissed`로 고정 → 같은 브라우저에서 다른 계정 로그인 시에도 팝업 비표시

**해결**: sessionStorage에서 계정 코드 읽어서 `selvas_acq_popup_dismissed_{계정코드}` 형태로 계정별 독립 관리

---

## 10. 알려진 이슈 및 현황

| # | 내용 | 상태 | 비고 |
|---|------|------|------|
| 1 | 공공데이터 주식 API 403 | 네이버 폴백으로 정상 운영 | API 활용 승인 대기 |
| 2 | 채권 시세 T+1 제공 | 정상 운영 | basDt 미지정으로 대응 |
| 3 | GAS 메일 발신 계정 설정 | Gmail 발신자 등록 필요 | matthew.y.jeong@selvas.com |
| 4 | 이슈 이력 수정/삭제 | 해결됨 (v2.1) | _ihIds 인덱스 방식 |
| 5 | 국채 날짜 형식 | 해결됨 | normDate() 헬퍼 |
| 6 | 취득가액 컬럼 | SQL 실행 완료 | equities + investments |

---

## 11. 개발 페이즈 로드맵

### Phase 2 — 자금정책 준수 상황판 (다음 작업)
**핵심 방향**:
- 기존 index.html의 통합 상황판과 별도 탭으로 분리
- `policy.html` 별도 파일로 구성 (자금정책 문서 관리)
- 대시보드 내 탭 전환: 통합 상황판 ↔ 자금정책 준수 상황판

**필요 Supabase 테이블**:
```sql
CREATE TABLE policies (
  id uuid PRIMARY KEY,
  company text,
  title text,
  category text,  -- 유동성/차입한도/투자제한 등
  content text,
  effective_date text,
  created_at timestamptz
);

CREATE TABLE policy_checks (
  id uuid PRIMARY KEY,
  policy_id uuid REFERENCES policies(id),
  company text,
  check_date text,
  status text,  -- compliant/warning/violation
  note text,
  created_at timestamptz
);
```

**자금정책 준수 상황판 구성요소**:
- 정책별 신호등 (준수/경고/위반)
- 이슈 카드와 정책 위반 항목 자동 연동
- 정책 문서 버전 관리

### Phase 3 — 자금일보 + 다단계 결재
- 자금일보 자동 생성 (당일 데이터 기반 포맷팅)
- 다단계 결재 프로세스: 작성 → 검토 → 승인
- 결재 이력 관리 + 반려 사유 기록
- PDF/Excel 자금일보 다운로드
- 메일 알림 (결재 요청/승인/반려)

**필요 테이블**: `reports`, `approvals`

### Phase 4 — 자금수지 + 채권회수
- 자금수지 예측 (수입/지출 캘린더 뷰)
- 채권회수 현황 관리 (거래처별 미수금 추적)
- 현금흐름 예측 대시보드 (30/60/90일)

**필요 테이블**: `cashflow_plan`, `receivables`

### 파일 분리 계획 (기능 안정화 후)
```
현재: index.html 단일 파일 (~10,900줄)

향후:
treasury/
├── index.html        (대시보드 + 레이아웃 + 라우팅)
├── policy.html       (자금정책 상황판)
├── css/
│   ├── base.css      (변수, 리셋)
│   ├── layout.css    (사이드바, 탑바)
│   └── components.css
├── js/
│   ├── core.js       (DB, 인증, 유틸, 환율)
│   ├── dashboard.js  (워터폴, 차트, 이슈)
│   ├── equity.js     (지분/국채 관리)
│   ├── issue.js      (이슈 이력)
│   └── policy.js     (자금정책)
└── img/
    ├── selvasai.png
    ├── selvashealthcare.png
    └── mediana.png
```

---

## 12. 환경 설정 및 배포 프로세스

### GitHub Pages 배포
```bash
# 파일 수정 후
git add index.html
git commit -m "feat: 취득가액 + 수익률 기능 추가 (v2.2)"
git push origin main
# → GitHub Actions 없이 자동 배포 (보통 30초~2분 내)
```

### GAS 재배포 절차
1. script.google.com 접속
2. GAS 프로젝트 열기
3. 배포 → 새 배포 → 웹 앱
4. 설명에 버전 메모 작성
5. 배포 후 새 URL을 index.html의 `GAS_API_URL` 변수에 업데이트

### GAS 스크립트 속성 설정
```
STOCK_API_KEY  → 공공데이터포털 주식 API 키
BOND_API_KEY   → 공공데이터포털 채권 API 키 (같은 키 사용 가능)
SUPABASE_KEY   → Supabase anon key
```

### Supabase 관련 SQL 이력
```sql
-- v2.2에서 실행 완료
ALTER TABLE equities ADD COLUMN IF NOT EXISTS acquisition_cost NUMERIC DEFAULT 0;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS acquisition_cost NUMERIC DEFAULT 0;

-- 이슈 키 마이그레이션 (이미 실행됨)
UPDATE issue_comments
SET issue_key = regexp_replace(issue_key, '_D\d+$', '')
WHERE issue_key ~ '_D\d+$';
```

---

## 13. 코드 품질 체크 방법 (PowerShell 환경)

```powershell
# Node.js JS 문법 체크
node --check index.html  # 안됨, 스크립트 블록만 추출해야 함

# Python으로 JS 블록 추출 후 문법 체크
python -c "
import re, subprocess, tempfile, os
with open('index.html') as f: c=f.read()
scripts = re.findall(r'<script(?!\s+src)[^>]*>(.*?)</script>', c, re.DOTALL)
for i, js in enumerate(scripts):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js); tmpf=f.name
    result = subprocess.run(['node','--check',tmpf], capture_output=True, text=True)
    os.unlink(tmpf)
    print(f'Block{i+1}: {\"OK\" if result.returncode==0 else result.stderr[:100]}')
"

# div 균형 체크
python -c "
import re
with open('index.html') as f: c=f.read()
o=len(re.findall(r'<div',c)); cl=len(re.findall(r'</div>',c))
print(f'div open:{o} close:{cl} diff:{o-cl}')
"
```

---

## 14. 현재 파일 버전 현황 (2026-05-28 기준)

| 파일 | 라인 수 | 비고 |
|------|---------|------|
| index.html | ~10,900줄 | 메인 앱 파일 |
| GAS_코드_v3.gs | ~579줄 | 주가/채권/환율/메일 |

### v2.2 변경 사항 (최신)
- 취득가액 입력 필드 추가 (주식/국채/비상장 공통)
- 수익률 자동 계산 + 호가창 스타일 배지 (상승=빨강, 하락=파랑)
- 통합 상황판 지분/장기투자 카드 수익률 + 미니 스파크라인
- 취득가액 과거이력 일괄반영 모달
- 취득가액 기능 업데이트 안내 팝업 (계정별 다시보지않기)
- 법인 전환 시 이슈 카드 즉시 초기화
- 현금흐름 추이 차트 날짜별 운용자금 계산 수정 (자금변동이력과 일치)
- 지분/장기투자 그래프 지분(핑크)+국채(파랑) 2데이터셋

### v2.1 변경 사항
- 이슈 이력 수정/삭제 버튼 (_ihIds 인덱스 방식)
- 국채 히스토리 패널 (지분과 동일 UX)
- 국채 평가금액 기준가÷10 수정
- 시세 툴팁 (전 영업일 시세, 익영업일 13시 이후)
- 날짜 형식 정규화 (normDate)
- 운용자금 메뉴에서 국채 제외 (지분/장기투자로 이관)
- GAS v3: 공공데이터 주식 API + 네이버 콤마 파싱 수정
- 운전자금 미입력 GAS 메일 알림

---

## 15. PowerShell 개발 환경 준비 가이드

### 필요 도구
```powershell
# Node.js 설치 확인
node --version

# Python 설치 확인
python --version

# Git 확인
git --version

# Claude CLI (Claude Code)
# https://docs.anthropic.com/claude-code 참고
```

### 작업 디렉토리 구조
```
C:\Users\{user}\treasury\   ← 로컬 레포지토리
├── index.html
├── selvasai.png
├── selvashealthcare.png
├── mediana.png
└── GAS_코드_v3.gs           ← GAS에 수동 복붙 (GitHub에는 미포함)
```

### 자주 쓰는 커맨드
```powershell
# 로컬 서버로 미리보기 (Python)
cd C:\Users\{user}\treasury
python -m http.server 8080
# 브라우저에서 http://localhost:8080 접속

# 변경사항 배포
git add index.html
git commit -m "fix: 설명"
git push

# 파일 라인 수 확인
(Get-Content index.html).Count
```

### Claude Code에서 작업 시 주의사항
1. `document.addEventListener('click', ...)` 전역 핸들러 절대 추가 금지
2. innerHTML로 버튼 삽입 시 onclick에 UUID 직접 사용 금지 → `_ihIds[]` 패턴 사용
3. 코드 추가 후 반드시 JS 문법 체크 + div 균형 체크
4. 함수 추가 시 중괄호 누락으로 전역 스코프 오염 주의
5. GAS 수정 시 반드시 재배포 필요 (URL 유지)
