# 개선 작업 — AS-IS / TO-BE (세션15차, 2026-06-19)

전체 기능·UI·UX 검토에서 도출한 P1~P3 개선안 중, **안전하게 검증 가능한 1차 배치**를 적용했습니다.
보안(P0)은 사용자 요청에 따라 향후 과제로 분리.

---

## ✅ 이번 배치에 적용된 개선

### 1. [B1·P1] 자금일보 "조회가 DB 쓰기를 유발" 차단
| 구분 | 내용 |
|------|------|
| **AS-IS** | 자금일보 페이지를 **열기만 해도** 평가손익 자동기재 effect가 `addItem/updateItem/removeItem`(DB write)을 실행. viewer(읽기전용) 계정이 열어도 데이터가 변경되고 감사 흔적이 남음. |
| **TO-BE** | 자동기재 effect 진입부에 `if (!canEdit()) return` 가드 추가. **viewer는 조회만**, 편집 권한자만 자동기재 수행. |
| **확인 방법** | viewer 계정으로 자금일보 열기 → 입출금 항목이 자동 생성/변경되지 않음. editor/master는 기존과 동일. |
| **파일** | `src/pages/DailyReportPage.tsx` (지분·국채 effect 양쪽) |

### 2. [B3·P1] 결재 다단계 순차성 강제
| 구분 | 내용 |
|------|------|
| **AS-IS** | 결재선이 여러 단계여도 **누구든 한 번 승인하면 즉시 `approved` 확정**. 1단계 미승인 상태에서 2단계 결재자가 바로 최종 승인 가능(순서 무시). |
| **TO-BE** | ① 본인 단계가 **'다음 기대 단계'일 때만** 승인 버튼 활성(이전 단계 미승인 시 차단). ② **최종 단계 승인 시에만** `status=approved` + `daily.confirmed=true` 확정, 중간 단계는 로그만 남기고 `submitted` 유지. ③ master는 다음 기대 단계를 대행 승인(오버라이드). |
| **확인 방법** | 2단계 결재선 설정 → 상신 → 2단계 결재자는 1단계 승인 전엔 승인 불가 → 1단계 승인 후 2단계 활성 → 2단계 승인 시 최종 확정. |
| **파일** | `src/hooks/useDailyReport.ts`(approveReport `isFinal` 인자), `src/pages/DailyReportPage.tsx`(nextStep 계산·게이팅) |

### 3. [B4·P2] 시세·환율 폴링 백그라운드 최적화
| 구분 | 내용 |
|------|------|
| **AS-IS** | 주가(5분)·환율(5분) 폴링이 **탭이 백그라운드여도 계속** GAS를 호출. 불필요한 부하·콜드스타트 유발. |
| **TO-BE** | `document.hidden`이면 폴링 skip. **탭 복귀 시 즉시 1회 갱신**(visibilitychange)으로 최신성 유지. |
| **확인 방법** | 다른 탭으로 전환 후 네트워크 탭에서 GAS 호출 멈춤 확인 → 복귀 시 1회 갱신. |
| **파일** | `src/hooks/useStockTicker.ts`, `src/pages/FxPage.tsx` |

### 4. [E1·P1] 자금일보 집계 중복 정의 제거
| 구분 | 내용 |
|------|------|
| **AS-IS** | `useDailyReportSummary`의 `itemSums`(훅 내부 `items` 기준)와 `DailyReportPage`의 `liveItemSums`(실시간 `itemHook.items` 기준)가 **이중 존재**. 훅 쪽은 stale이며 소비처가 없음(죽은 코드). |
| **TO-BE** | 사용되지 않는 훅의 `itemSums` 계산·반환 제거. **`liveItemSums` 단일 진실원천**으로 정리(`ItemSums` 타입은 유지). |
| **확인 방법** | 자금일보 표시·검증 동작 동일(회귀 없음), 코드 단순화. |
| **파일** | `src/hooks/useDailyReportSummary.ts` |

### 5. [C4·P3] 팝업 ESC 닫기 (접근성)
| 구분 | 내용 |
|------|------|
| **AS-IS** | 대시보드 상세 팝업(FlowDetailDrawer)·이슈 팝업(IssueDrawer)이 **딤 클릭으로만** 닫힘. 키보드 사용자 불편. |
| **TO-BE** | **ESC 키로 닫기** 핸들러 추가. |
| **확인 방법** | 팝업 연 뒤 ESC → 닫힘. |
| **파일** | `src/components/dashboard/FlowDetailDrawer.tsx`, `IssueDrawer.tsx` |

---

### 6. [D1·P1] 집계 단일 진실원천(SSOT) 통합 ⭐
| 구분 | 내용 |
|------|------|
| **AS-IS** | 운전자금 원화합계·외화환산·국채평가 계산이 `useDashboard`/`useDailyReportSummary`/`ReportSummaryTable`/`DailyReportPage`(검증)/`FlowDetailDrawer`/`InvestPage`에 **각자 복제**. 특히 운전자금 외화: 대시보드·`opTotal`은 **저장값 `fx_krw`**, 자금일보 표시·검증은 **현재환율 재계산** → 환율 변동 시 **"자금일보 총합계 ≠ 대시보드 가용자금"** (UI 푸터 "일치해야 합니다" 위반). |
| **TO-BE** | 순수 계산 모듈 **`src/lib/treasuryCalc.ts`** 신설(`opCashKRW`/`toKRWAmount`/`bondValueOf`/`investValueKRW`). 모든 소비처를 이 함수로 통일. **운전자금 원화합계는 전부 저장값 `fx_krw` 기준**으로 일원화 → 대시보드 가용자금 = 자금일보 운전자금 소계/총합계 = 검증식 운전자금 Δ **동일 공식**. |
| **변경된 동작** | 자금일보 **운전자금 소계·자금 총합계·검증식**이 현재환율 재계산 → **저장 `fx_krw` 기준**으로 변경. 과거 일보(입력일과 환율이 다른 경우)에서 기존 대비 외화 환산분이 입력시점 환율로 표시됨(더 정확). FX 행별 '원화환산' 열은 현재환율 참고치로 유지(권위값은 소계). |
| **확인 방법** | 같은 날짜에 대시보드 가용자금 합계와 자금일보 '자금 총합계'가 일치하는지 비교. 환율 변동 후에도 두 화면이 동일. |
| **파일** | `src/lib/treasuryCalc.ts`(신규), `useDashboard.ts`, `useDailyReportSummary.ts`, `ReportSummaryTable.tsx`, `DailyReportPage.tsx`, `FlowDetailDrawer.tsx`, `InvestPage.tsx` |
| **남은 통합** | 운용자금 그룹핑(예금성/비예금성 vs 가용/불가용)은 화면별 표현 목적이 달라 미통합 — 값 프리미티브만 SSOT화. 국채 평가도 `bondValueOf`로 통일(자금일보 비예금성 그룹의 통화환산 폴백은 보수적으로 유지). |

---

### 7. [D2·P2] 회사 컨텍스트 일원화 (`usePageCompany`)
| 구분 | 내용 |
|------|------|
| **AS-IS** | "URL `:company` param + `currentCompany` + 기본법인" 해석과 URL↔컨텍스트 동기화 로직이 **9개 페이지에 제각각 복제**(fallback `'셀바스에이아이'` vs `companies[0]`, 검증 방식, `role==='company'` 처리, `replace` 유무가 미묘하게 달라 일관성 저하·버그 소지). |
| **TO-BE** | 신규 훅 **`src/hooks/usePageCompany.ts`** — AuthContext(이미 단일 소스)를 감싸 ① `company`(param>context>기본) 해석 ② param→context 동기화 ③ `setCompany`(컨텍스트 갱신 + basePath 시 URL replace)를 **한 곳**으로 통일. 9개 페이지 모두 이 훅 사용. zustand 전면 도입 없이 기존 구조 재사용(저위험). |
| **변경된 동작** | 동작 동일(해석 규칙 표준화). 페이지별 중복 `useEffect`/IIFE 제거로 코드 단순화. AuditLog 탭 전환이 `push`→`replace`로 통일(히스토리 누적 감소). |
| **확인 방법** | 각 페이지에서 URL에 법인 지정 진입·탭 전환 시 회사 컨텍스트가 일관되게 반영, 새로고침 후 유지. |
| **적용 페이지** | Dashboard / Equity / History / Invest / Loans / DailyReport / DailyReportList / FxTradeHistory / AuditLog |
| **파일** | `src/hooks/usePageCompany.ts`(신규) + 위 9개 페이지 |

---

### 8. [B2·P2] GAS 시세 연결 상태 표시 (경량)
| 구분 | 내용 |
|------|------|
| **AS-IS** | 시세·환율이 GAS 단일 의존인데, GAS 연결 실패 시 TopBar 티커가 **그냥 비어 있어** 사용자가 "데이터가 없는 건지 / 연결이 끊긴 건지" 구분 불가. `useStockTicker`가 `error`를 노출하지만 화면에 표시 안 됨. |
| **TO-BE** | TopBar 중앙 영역에 **빨간 점 + "시세 연결 끊김"** 표시(로딩 아님 + 시세 없음 + error 일 때). 툴팁에 사유·자동 재시도 안내. 폴링이 자동 복구되면 자동으로 티커로 전환. |
| **변경된 동작** | 표시 전용 추가 — 기존 데이터 흐름 무변경. |
| **확인 방법** | GAS 미연결/오프라인 상태에서 TopBar에 빨간 "시세 연결 끊김" 표시 → 복구 시 자동으로 시세 티커 표시. |
| **파일** | `src/components/TopBar.tsx` |
| **남은 B2** | 환율(Sidebar)·공휴일 폴백, 캐시 기반 degrade 표시는 후속(이번엔 시세 인디케이터만). |

---

### 9. [C2·P3] 색각 접근성 — 자금현황 Δ 방향 글리프
| 구분 | 내용 |
|------|------|
| **AS-IS** | 앱 전반의 증감 표시는 대부분 `+/-` 부호·`▲▼`가 색과 함께 쓰여 양호. 단 자금현황 테이블의 Δ(DeltaCell)은 색 + `+/-` 부호만 사용. |
| **TO-BE** | 가장 데이터 밀도 높은 자금현황 테이블 DeltaCell에 **방향 글리프(▲/▼)**를 부호와 함께 표기 → 색 없이도 증감 구분. (수익률 배지·순현금 등은 이미 부호 포함이라 미변경) |
| **변경된 동작** | 표시 전용. Δ 셀이 `▲ +1,234` / `▼ -567` 형태로 표시. |
| **파일** | `src/components/daily-report/ReportSummaryTable.tsx` |

---

### 10. [B2 잔여·P2] Sidebar 환율 연결 끊김 표시
| 구분 | 내용 |
|------|------|
| **AS-IS** | GAS 환율 조회 실패 시 Sidebar 환율 섹션이 각 통화 '—'(펼침) / '데이터 없음'(접힘 팝업)만 표시 → 연결 끊김인지 불분명. |
| **TO-BE** | 실패(빈 값) 상태에 **🔴 "환율 연결 끊김"** 명시(펼침·접힘 양쪽). `↺ 재시도` 버튼 유지. |
| **변경된 동작** | 표시 전용. 공휴일은 이미 localStorage 캐시 폴백이 있어 별도 표시 생략. |
| **파일** | `src/components/Sidebar.tsx` |

---

### 11. [D4·P3] 이슈 ↔ 원천 레코드 링크 표준화
| 구분 | 내용 |
|------|------|
| **AS-IS** | 이슈→원천 링크 매핑이 `IssueDrawer`(대시보드 팝업)에만 `buildLinkUrl`로 존재. **IssueHistoryPage엔 원천 바로가기 없음**. policy_ 키 미지원. |
| **TO-BE** | 공유 헬퍼 **`src/lib/issueLink.ts`**(`issueSourceUrl`/`issueSourceLabel`) 신설. IssueDrawer는 이를 사용(중복 제거), **IssueHistoryPage 스레드에 "원천 바로가기 ↗" 추가**. policy_ 매핑 포함. |
| **변경된 동작** | 이슈 상세에서 운전자금/차입금/종목/자금정책 원천으로 이동 가능. |
| **파일** | `src/lib/issueLink.ts`(신규), `IssueDrawer.tsx`, `IssueHistoryPage.tsx` |
| **역방향 (추가됨)** | LoansPage 차입금 행에 **🔔 이슈** 링크(→ `/issue-history/loan_{id}`) 추가. 차입금이 만기 이슈의 주 발생원이라 우선 적용. EquityPage(행 클릭=패널 토글 충돌 우려)는 후속. |

---

### 12. [D5·P3] 대시보드 FlowDetailDrawer 딥링크 표준화 (경량)
| 구분 | 내용 |
|------|------|
| **AS-IS** | 자금흐름 상세 팝업 하단 바로가기가 if 나열 분기로 5개 키만 처리, `fx` 키는 딥링크 누락. |
| **TO-BE** | 항목별 딥링크를 **맵(`SHORTCUTS`)으로 표준화**하고 `fx → /fx` 추가. 신규 키 추가가 한 줄로 가능. |
| **변경된 동작** | FX 항목에서 '환율 현황 →' 바로가기 노출. 기존 키 동작 동일. |
| **파일** | `src/components/dashboard/FlowDetailDrawer.tsx` |
| **남은 부분** | net/unavailable/asset 은 복합 항목이라 단일 타겟 없음(딥링크 제외 유지). |

---

### 13. [C5·P3] 공통 토스트 인프라 + 대표 페이지 적용
| 구분 | 내용 |
|------|------|
| **AS-IS** | 페이지마다 `setError`/`setSuccess` 후 표시 방식이 제각각(인라인 배너 등), 일관된 알림 부재. |
| **TO-BE** | 전역 **`ToastProvider`**(`src/contexts/ToastProvider.tsx`) + `useToast()` 신설 — 우상단 스택, 성공/실패/안내 타입, 자동 소멸(3.5s)·클릭 닫기·다크모드. App 최상위 마운트. **Invest/Loans 저장 성공·실패**에 우선 적용. |
| **변경된 동작** | 운전자금/운용자금/차입금 저장·삭제 시 토스트 알림. 기존 인라인 표시는 유지(비파괴적). |
| **확인 방법** | 운전/운용/차입 등록·수정·삭제 시 우상단 토스트, 실패 시 빨간 토스트. |
| **파일** | `src/contexts/ToastProvider.tsx`(신규), `App.tsx`, `InputPage.tsx`, `InvestPage.tsx`, `LoansPage.tsx` |
| **남은 부분** | Equity(자식 폼)·admin 등 `setError`→토스트 점진 적용은 후속(인프라 완비). 앱 부팅 정상 확인(미리보기). |
| **부수 발견** | InputPage 는 D2 회사 컨텍스트 일원화(`usePageCompany`) 미적용 상태 — 후속 정리 대상(`remaining_work_plan.md` 기록). |

---

### 14. [소형 정리 배치] InputPage D2 + C5 확산(Equity) + D4 Equity 역링크
| 항목 | AS-IS → TO-BE | 파일 |
|------|---------------|------|
| **InputPage D2** | 운전자금 페이지만 `usePageCompany` 미적용 → 9개 페이지와 통일(중복 sync effect·IIFE 제거) | `InputPage.tsx` |
| **C5 확산(Equity)** | 취득가액 일괄저장·시세/기준가 일괄갱신에 성공/실패 토스트 추가(기존 인라인 유지) | `EquityPage.tsx` |
| **D4 Equity 역링크** | 종목 행 펼침 영역에 **🔔 이 종목 이슈 보기 ↗**(→ `/issue-history/equity_{name}`) 추가. 행 클릭=패널 토글과 충돌 없게 펼침 영역에 배치. 지분·비상장 탭 모두 적용 | `EquityPage.tsx` |

> 남은 C5 확산: admin 페이지(UsersPage/CompaniesPage 등)는 후속.

---

## 🔜 다음 단계 (대규모 — 별도 진행 권장)

다음 항목은 영향 범위가 넓어(다수 파일·아키텍처 변경) 별도 설계·검증 단위로 분리합니다.

| 항목 | 사유 | 제안 |
|------|------|------|
| ~~D1 집계 SSOT 통합~~ | ✅ 완료 (위 6번 항목) | — |
| ~~D2 회사 컨텍스트 일원화~~ | ✅ 완료 (위 7번 항목 — usePageCompany) | — |
| **B2 GAS 헬스/폴백** | 시세·환율·공휴일·ECOS 단일 의존. 폴백/상태표시 추가 | 연결상태 인디케이터 + 캐시 폴백 |
| **C1 아이콘 마이그레이션** | 이모지 → Tabler Icons. 45+ 파일 영향 | 컴포넌트 래퍼 도입 후 점진 치환 |
| **C2/C3/C5** | 색각 보강·모바일 카드뷰·공통 토스트 | UX 일괄 개선 스프린트 |
| **D4/D5** | 이슈 역링크·딥링크 표준화 | 연동 규약 정의 후 적용 |

---

## 검증 상태
- `pnpm build` ✅ 통과
- 고아 import / 타입 오류 없음
- 라이브 화면 검증: 로그인 세션 필요 — 실 배포 환경에서 위 "확인 방법"으로 점검 요망
