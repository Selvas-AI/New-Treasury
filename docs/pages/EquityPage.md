# EquityPage (지분/장기투자)

**파일**: `src/pages/EquityPage.tsx`  
**라우트**: `/equity`, `/equity/:company`, `/equity/:company/:name`  
          `/bonds`, `/bonds/:company`, `/bonds/:company/:isin`  
**데이터**: `equities` 테이블 + `investments` 테이블 (product='국채')  
**권한**: master·company 편집 / ceo 읽기 전용

---

## 탭 구성

| 탭 | 데이터 소스 | 조건 |
|----|------------|------|
| 지분 (주식) | `equities` | `market !== '비상장'` |
| 국채/채권 | `investments` | `product === '국채'` |
| 비상장/기타 | `equities` | `market === '비상장'` |

## 종목 행 → 히스토리 패널

```
종목 행 클릭 → openPanel 상태 토글 → 아코디언 펼침
                                      ↓
                          EquityHistoryPanel 또는
                          BondHistoryPanel 렌더
```

### 지분/비상장: EquityHistoryPanel
- 날짜별 시세 추가/수정/삭제
- GAS 주가 조회 버튼 (상장 종목만)
- 취득가액 → 과거이력 일괄반영 confirm

### 국채: BondHistoryPanel
- 날짜별 기준가 추가/수정/삭제
- ISIN 기준 GAS 채권 시세 조회 (T+1)
- 좌수 × (기준가÷10) = 평가금액

## 국채 최신 1건 표시

```typescript
getLatestBonds(inv.bonds)  // bondTicker 또는 bondName 기준 최신 날짜 1건
```

## 딥링크

```
/equity/셀바스에이아이/삼성전자   → 해당 종목 패널 자동 오픈
/bonds/셀바스에이아이/KR1234...   → 해당 ISIN 패널 자동 오픈
```

## 변경 포인트

- **탭 추가**: `tab` 타입 유니언 + 탭 배열에 항목 추가
- **일괄 시세 갱신 버튼**: 현재 미구현 — `fetchStockPrice` 반복 호출 필요
- **시장 구분 추가**: `market` 타입 확장 + KOSPI 등 필터 추가
