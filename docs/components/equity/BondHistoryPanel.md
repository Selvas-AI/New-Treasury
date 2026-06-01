# BondHistoryPanel

**파일**: `src/components/equity/BondHistoryPanel.tsx`  
**역할**: 국채/채권 날짜별 시세 이력 패널 (아코디언 내부)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `bondName` | `string` | 채권명 |
| `isin` | `string` | ISIN 코드 (KR...) |
| `company` | `string` | 보유 법인명 |
| `history` | `InvestmentRecord[]` | 해당 채권 전체 이력 |
| `onSave` | `(record) => Promise<string\|null>` | 저장 콜백 (useInvestments.save) |
| `onRemove` | `(id) => Promise<string\|null>` | 삭제 콜백 |
| `onBulkAcq` | `(ids[], cost) => Promise<string\|null>` | 취득가액 일괄반영 |
| `isEditable` | `boolean` | ceo 역할은 false |

## 핵심 계산

### 국채 평가금액 공식
```
평가금액 = 좌수 × (기준가 ÷ 10)
```
- 공공데이터 API의 `clprPrc`(기준가)는 액면 10,000원 기준
- 실제 1좌당 가격 = 기준가 ÷ 10

### 채권 시세 조회 (GAS API)
```typescript
fetchBondPrice(isin, basDt?)
// basDt 생략 시 최근 유효 데이터 자동 조회 (T+1 제공)
// basDt 지정 시 특정 날짜 조회 (YYYYMMDD 형식)
```
- T+1 제공: 당일/전일 데이터 없음, 익영업일 13시 이후 갱신

## 저장 레코드 구조

```typescript
{
  company, bank: bondName, product: '국채',
  currency: 'KRW',
  amount: calcBondValue(qty, price),  // 평가금액
  available, rate: 0,
  start: priceDate,
  bondName, bondTicker: isin,
  bondQty: qty, bondPrice: price,
  priceDate, acquisition_cost
}
```

## 변경 포인트

- **시세 조회 API**: `fetchBondPrice()` (useGas.ts)
- **평가금액 공식**: `calcBondValue()` (format.ts)
- **T+1 정책**: GAS의 `getBondPrice` 함수 수정
