# NewBondForm

**파일**: `src/components/equity/NewBondForm.tsx`  
**역할**: 국채/채권 신규 등록 인라인 폼 (토글 방식)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `company` | `string` | 보유 법인명 |
| `onSave` | `(record) => Promise<string\|null>` | 저장 콜백 (useInvestments.save) |
| `isEditable` | `boolean` | false 시 컴포넌트 자체를 null 반환 (ceo 역할) |

---

## 주요 기능

### 버튼 → 폼 토글
- 접힌 상태: "+ 국채/채권 신규 등록"
- 열린 상태: `bg-blue-50` 인라인 폼, 취소 버튼으로 리셋

### 입력 필드
| 필드 | 비고 |
|------|------|
| 채권명 | 필수. bank 필드에 저장 |
| ISIN (종목코드) | bondTicker 필드. 입력 시 시세 조회 버튼 노출 |
| 기준일 | date picker, 기본값 오늘 |
| 보유 좌수 | bondQty |
| 기준가 | bondPrice. `÷10 = 1좌당 가격` 안내 표시 |
| 취득가액 (총액) | acquisition_cost |
| 가용 여부 | 가용 / 불가용 select |

### 채권 기준가 자동 조회
- `fetchBondPrice(isin)` (useGas.ts) 호출
- 응답의 `price`, `date` → bondPrice, priceDate에 자동 입력
- `normDate(res.date)` 로 날짜 정규화 (YYYYMMDD → YYYY-MM-DD)
- GAS 미연결 또는 T+1 지연 시 에러 메시지 표시

### 저장 미리보기
- `calcBondValue(bondQty, bondPrice)` 평가금액 실시간 표시
- `calcReturn(평가금액, 취득가액)` → 수익률 배지

### 저장 후 데이터 매핑
- `product: '국채'` 고정
- `amount = calcBondValue(qty, price)` 로 계산된 값 저장
- `rate: 0`, `currency: 'KRW'` 고정값

---

## 변경 포인트

- **GAS 채권 시세 소스 변경**: `fetchBondPrice()` (useGas.ts) + `VITE_GAS_API_URL`
- **국채 평가금액 공식**: `bondQty × (bondPrice ÷ 10)` — `calcBondValue()` 사용
- **EquityPage 채권 탭에서 사용**: `<NewBondForm company={...} onSave={...} isEditable={...} />`
