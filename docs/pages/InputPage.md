# InputPage (운전자금 입력)

**파일**: `src/pages/InputPage.tsx`  
**라우트**: `/input`, `/input/:company`, `/input/:company/:date`  
**데이터**: `daily` 테이블  
**권한**: master·company 편집 / ceo 읽기 전용

---

## 입력 필드

| 필드 | DB 컬럼 | 설명 |
|------|---------|------|
| 기준일 | `date` | YYYY-MM-DD |
| 작성자 | `writer` | 로그인 사용자명 기본값 |
| 보통예금/CMA | `krw_demand` | |
| 국책자금 | `krw_govt` | |
| 증권 예수금 | `krw_mmda` | |
| USD | `fx_usd` | |
| EUR | `fx_eur` | |
| JPY | `fx_jpy` | |
| GBP | `fx_gbp` | |
| CNY | `fx_cny` | |
| 외화 원화환산 | `fx_krw` | **자동 계산** (GAS 환율 기준) |
| 메모 | `memo` | |

## 자동 계산

```typescript
fx_krw = toKRW(fx_usd, 'USD') + toKRW(fx_eur, 'EUR') + ...
합계 = krw_demand + krw_govt + krw_mmda + fx_krw
```
→ GAS API 환율 미로드 시 fx_krw = 0 (직접 입력 가능)

## 저장 방식

`useDaily().upsert()` 사용 → **같은 날짜+법인 레코드 있으면 덮어쓰기**

## 이력 테이블

- 날짜 내림차순 (최신 상단)
- 오늘 날짜 행: 파란 배경 하이라이트
- 수정 클릭 → 폼에 데이터 로드 + 상단 스크롤

## 딥링크

```
/input/셀바스에이아이/2026-05-29
→ 법인 자동 전환 + 날짜 자동 세팅
```

## 변경 포인트

- **외화 종류 추가**: `FX_FIELDS` 배열 + DB 컬럼 추가 필요
- **합계 계산 방식**: `totalKrw` useMemo 수정
