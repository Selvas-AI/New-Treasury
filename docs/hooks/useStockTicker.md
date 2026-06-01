# useStockTicker

**파일**: `src/hooks/useStockTicker.ts`  
**역할**: 3개 법인 주가 5분 폴링 훅 (TopBar 주가 티커용)

---

## 반환값

```typescript
const { tickers, loading, error, lastAt } = useStockTicker()
```

| 필드 | 타입 | 설명 |
|------|------|------|
| `tickers` | `TickerItem[]` | 3개 종목 주가 배열 |
| `loading` | `boolean` | 초기 로딩 또는 갱신 중 |
| `error` | `string \| null` | 전체 실패 시 메시지 |
| `lastAt` | `string \| null` | 마지막 갱신 시각 (HH:MM 형식) |

### TickerItem

```typescript
interface TickerItem extends StockPriceResult {
  shortName: string  // 표시 이름 (예: 셀바스AI)
}

// StockPriceResult (useGas.ts)
interface StockPriceResult {
  code: string
  price: number
  date: string       // YYYY-MM-DD
  change?: number    // 전일 대비 등락 (원)
  changePct?: number // 등락률 (%)
}
```

---

## 동작 방식

### 모니터링 종목
```typescript
const STOCKS = [
  { code: '108860', shortName: '셀바스AI'  },
  { code: '208370', shortName: '셀바스HC'  },
  { code: '041920', shortName: '메디아나'  },
]
```

### 폴링 주기
- `POLL_MS = 5 * 60 * 1000` (5분)
- 마운트 시 즉시 1회 호출 후 인터벌 시작
- 언마운트 시 `cancelled = true` + `clearInterval`

### GAS 미연결 시 Fallback
- 초기값: `price: 0` mock 배열 유지
- `Promise.allSettled` 사용 → 일부 종목만 실패해도 나머지 표시
- 모두 실패 시 `error = 'GAS 연결 필요'`
- TopBar에서 `hasPrices = tickers.some(t => t.price > 0)` 로 분기

### 폴링 패턴 (CLAUDE.md 권장 패턴 준수)
```typescript
useEffect(() => {
  let cancelled = false
  async function run() { /* fetch + setState */ }
  void run()
  const timer = window.setInterval(() => void run(), POLL_MS)
  return () => { cancelled = true; window.clearInterval(timer) }
}, [])
```
`window.setInterval` 명시 사용 — `@types/node` 타입 충돌 방지

---

## 변경 포인트

- **종목 추가/변경**: `STOCKS` 배열 수정
- **폴링 주기 변경**: `POLL_MS` 상수 수정
- **GAS 주가 응답 형식 변경**: `StockPriceResult` (useGas.ts) 수정
