# KpiCard

**파일**: `src/components/dashboard/KpiCard.tsx`  
**역할**: 단일 KPI 수치를 색상 배경 카드로 표시

---

## Props

| Prop | 타입 | 필수 | 설명 |
|------|------|------|------|
| `label` | `string` | ✅ | 카드 상단 레이블 |
| `value` | `number` | ✅ | 표시할 원화 금액 |
| `sub` | `string` | — | 하단 보조 설명 (구성 내역 등) |
| `color` | `'blue'│'green'│'red'│'gray'│'purple'` | — | 배경 색상 (기본: gray) |

## 색상 용도 규칙

| color | 사용 예 |
|-------|---------|
| `blue` | 가용자금, 운전자금 |
| `green` | 순현금 (양수) |
| `red` | 순현금 (음수), 차입금 |
| `gray` | 불가용 자산, 중립 |
| `purple` | 비상장/기타 |

## 사용 위치

- `DashboardPage.tsx` — KPI 3카드 행
- `InputPage.tsx` — 운전자금 상세 4카드

## 변경 포인트

- **색상 추가**: `COLOR` 객체에 키 추가 후 `Props.color` 유니언 확장
- **금액 포맷 변경**: `fmtKRW()` 함수 수정 (src/lib/format.ts)
- **크기 조정**: Tailwind `text-xl` → `text-2xl` 등
