# NewEquityForm

**파일**: `src/components/equity/NewEquityForm.tsx`  
**역할**: 지분(상장/비상장) 신규 종목 등록 인라인 폼 (토글 방식)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `company` | `string` | 보유 법인명 |
| `fixedMarket` | `'KOSPI' \| 'KOSDAQ' \| '비상장' \| undefined` | 고정 시장. 미지정 시 폼 내 select로 선택 |
| `onSave` | `(record) => Promise<string\|null>` | 저장 콜백 (useEquities.save) |
| `isEditable` | `boolean` | false 시 컴포넌트 자체를 null 반환 (ceo 역할) |

---

## 주요 기능

### 버튼 → 폼 토글
- 접힌 상태: "+ KOSPI 종목 신규 등록" 등 컨텍스트 맞는 레이블
- 열린 상태: `bg-blue-50` 인라인 폼, 취소 버튼으로 리셋

### 입력 필드
| 필드 | 비고 |
|------|------|
| 종목명 | 필수 |
| 티커 (종목코드) | 비상장이면 숨김 |
| 시장 | `fixedMarket` 미지정 시 KOSPI/KOSDAQ select 표시 |
| 기준일 | date picker, 기본값 오늘 |
| 보유 주수 | number |
| 주가 (원) | number + **시세 조회 버튼** (ticker 입력 시 노출) |
| 취득가액 (총액) | number |
| 투자목적 | 비상장은 기본 정보 row에, 상장은 하단 row에 표시 |
| 가용 여부 | 가용 / 불가용 select |

### 시세 자동 조회
- `fetchStockPrice(ticker)` (useGas.ts) 호출
- 응답의 `price`, `date` → 폼에 자동 입력
- GAS 미연결 시 에러 메시지 표시

### 저장 미리보기
- `shares × price` 실시간 평가금액 표시
- `calcReturn(평가금액, 취득가액)` → 수익률 배지

---

## 변경 포인트

- **시장 종류 추가**: `EMPTY.market` 타입 + select 옵션 수정
- **GAS 시세 조회 소스 변경**: `fetchStockPrice()` (useGas.ts) + `VITE_GAS_API_URL`
- **EquityPage에서 사용처**: 각 탭 상단에 `<NewEquityForm fixedMarket={...} />`
