# Selvas Treasury — 기능 구현 TODO

> 분석 기준: SELVAS_TREASURY_CONTEXT.md vs 실제 src/ 구현 (2026-06-02)
> UI/UX 관련 항목 제외. 데이터·로직·기능 누락만 포함.

---

## 🔴 미구현 핵심 기능 (High Priority)

- [ ] **외화 잔고 원화 환산 자동 계산 (InputPage)**: `InputPage.tsx`에서 fx_usd/eur/jpy/gbp/cny 입력 시 실시간 환율 적용 `fx_krw` 자동 계산이 없음. 현재는 사용자가 `fx_krw`를 직접 입력해야 함. `useFx().toKRW()`와 환율 데이터를 활용해 5개 외화 잔고 합산 → `fx_krw` 자동 산출 로직 필요.

- [ ] **운용자금 자동 시세 갱신 (InvestPage)**: GAS `getStockPrice` 연동을 통한 지분(주식) 전체 종목 일괄 시세 갱신 버튼이 없음. `useStockTicker.ts`는 TopBar 티커용 3개 법인 주가만 폴링하며, `EquityHistoryPanel`/`BondHistoryPanel` 내에서 개별 종목 시세 조회 연동(`useGas.ts`의 `fetchStockPrice`, `fetchBondPrice`)이 구현되지 않음.

- [ ] **영업일 공휴일 데이터 다년도 부재**: `src/lib/format.ts`의 `isBusinessDay()`가 2026년 공휴일만 하드코딩(`KR_HOLIDAYS_2026`). 이슈 감지(`useDashboard.ts`)와 운전자금 미입력 알림이 2026년 이후 또는 2025년 이전 날짜에는 오작동함.

- [ ] **채권 기준가 GAS 조회 연동 (BondHistoryPanel)**: `BondHistoryPanel.tsx`에서 날짜 선택 후 GAS `getBondPrice?isin=...&basDt=...` 호출 → 기준가 자동 입력 기능이 미구현. `useGas.ts`에 `fetchBondPrice` 함수가 있어도 패널에서 호출하지 않음.

---

## 🟡 불완전한 기능 / 보완 필요 (Medium Priority)

- [ ] **HistoryPage 운용자금 날짜별 계산 부정확**: `HistoryPage.tsx` 99행 — 운용자금 날짜 필터링 기준을 `i.start || i.priceDate`로 사용하나, `investments` 테이블의 날짜 필드는 `start`, `start_date`, `priceDate` 세 가지가 혼용됨. `start_date`(legacy 필드) 누락으로 일부 레코드가 필터에서 제외될 수 있음. `SELVAS_TREASURY_CONTEXT.md` §3-2 참조.

- [ ] **이슈 openCount 중복 카운팅**: `useIssues.ts`의 `openCount`가 `data.filter(c => c.status !== 'done').length`로 코멘트 개수 기준임. 동일 `issue_key`에 여러 코멘트가 달리면 1개 이슈가 N개로 카운팅됨. 실제 이슈 수는 `issue_key`별로 최신 상태만 봐야 함 (기존 HTML의 배지 카운트 로직과 불일치).

- [ ] **차입금 만기 이슈 감지 범위**: `useDashboard.ts` 149행 — `dday <= 90`만 체크하나 `dday < 0`(이미 만기 경과)인 경우도 포함되어야 함. 또한 `dday`가 음수일 때 `D--30`처럼 잘못된 문자열이 이슈 title에 표시됨 (`D-${dday}` 직접 보간).

- [ ] **운전자금 미입력 이슈 — 법인 전환 시 즉시 초기화 누락**: `DashboardPage.tsx`에서 법인 전환 시 `detectedIssues`는 새 법인 데이터가 로드된 후에야 갱신됨. 전환 직후 이전 법인의 이슈가 잠깐 표시되는 버그 (기존 HTML §9-5에서 해결된 문제가 React 버전에서 미적용).

- [ ] **FxPage 환율 조회 자동 로드 미연동**: `src/pages/FxPage.tsx`(PlaceholderPage로 추정)에서 실제 환율 현황 기능이 구현되지 않음. `useFx` 훅은 `fetchRates()`를 수동 호출해야 하며 자동 로드 트리거 없음.

- [ ] **취득가액 일괄반영 모달 자동 표시 미구현**: `SELVAS_TREASURY_CONTEXT.md` §7 — 취득가액 저장 완료 0.4초 후 과거이력 일괄반영 모달이 자동 표시되어야 하나, `EquityHistoryPanel.tsx`/`BondHistoryPanel.tsx`에서 저장 후 자동 모달 호출 로직이 없음. `updateAcquisitionCost` 함수는 구현됐으나 UI 트리거 연결 누락.

- [ ] **price_history 테이블 미활용**: Supabase `price_history` 테이블(`key`, `date`, `value`)이 스키마에 정의되어 있으나 React 훅/페이지 어디에도 이 테이블을 읽거나 쓰는 코드가 없음. 지분/채권 시세 이력 별도 저장 기능 미구현.

---

## 🟢 미구현 부가 기능 (Low Priority)

- [ ] **관리 페이지 (AdminPage) 미구현**: 라우팅에 `/admin/mycode`, `/admin/users`, `/admin/data` 경로가 있으나 실제 페이지 구현 없이 PlaceholderPage로 대체됨. 특히 `access_codes` 테이블 CRUD(사용자 관리)와 데이터 일괄 관리 기능 누락.

- [ ] **자금정책 / 자금일보 페이지**: Phase 2/3 로드맵 항목. `policies`, `policy_checks`, `reports`, `approvals` 테이블 미생성. 현재 라우팅에도 해당 경로 없음.

- [ ] **GAS 자동 시세 스케줄러 ON/OFF 토글**: 기존 HTML에서 `localStorage: auto_price_on`으로 관리하던 자동 시세 조회 ON/OFF 기능이 React 버전에 없음. `useStockTicker.ts`는 항상 폴링 활성화 상태.

- [ ] **`calcKRW` 함수 중복 정의**: `src/lib/format.ts`에 `calcKRW(amount, code, rates)` 함수가 있고, `useFx.ts`에 `toKRW(amount, code)` 메서드가 중복 구현됨. 로직은 동일하나 인터페이스가 달라 소비처마다 다른 방식을 사용할 위험이 있음. 통일 필요.
