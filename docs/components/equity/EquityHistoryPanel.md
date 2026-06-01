# EquityHistoryPanel

**파일**: `src/components/equity/EquityHistoryPanel.tsx`  
**역할**: 지분(주식) 및 비상장 종목의 날짜별 시세 이력 패널 (아코디언 내부)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `name` | `string` | 종목명 |
| `ticker` | `string` | KRX 종목코드 (6자리) |
| `market` | `string` | KOSDAQ / KOSPI / 비상장 |
| `company` | `string` | 보유 법인명 |
| `history` | `EquityRecord[]` | 해당 종목 전체 이력 (날짜 내림차순) |
| `onSave` | `(record) => Promise<string\|null>` | 저장 콜백 (useEquities.save) |
| `onRemove` | `(id) => Promise<string\|null>` | 삭제 콜백 |
| `onBulkAcq` | `(name, cost) => Promise<string\|null>` | 취득가액 일괄반영 콜백 |
| `isEditable` | `boolean` | false 시 폼/버튼 숨김 (ceo 역할) |

## 주요 기능

### 시세 추가/수정 폼
- 기준일, 보유 주수, 주가(원), 취득가액(총액), 투자목적, 가용여부
- **주가 조회 버튼**: GAS API (`fetchStockPrice(ticker)`) → 가격·날짜 자동입력
  - `market === '비상장'` 이거나 `ticker` 없으면 버튼 숨김
- **평가금액 미리보기**: `shares × price` 실시간 계산
- **수익률 미리보기**: `calcReturn(평가금액, 취득가액)` + returnBadgeClass

### 저장 후 취득가액 일괄반영
- 신규 저장 + `acquisition_cost > 0` 이면 confirm 팝업
- 확인 시 `onBulkAcq(name, cost)` 호출 → 동일 종목 전체 이력에 반영

### 이력 테이블
| 컬럼 | 설명 |
|------|------|
| 기준일 | date |
| 주수 | shares (콤마 포맷) |
| 주가 | price (원) |
| 평가금액 | total_value |
| 수익률 | calcReturn 배지 |
| 취득가액 | acquisition_cost |
| 가용 | available 배지 |

## 변경 포인트

- **자동 시세 조회 소스 변경**: `fetchStockPrice()` 함수 (useGas.ts)
- **GAS API 변경 시**: `VITE_GAS_API_URL` 환경변수 + GAS 코드 수정
