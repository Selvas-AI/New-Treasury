# TopBar

**파일**: `src/components/TopBar.tsx`  
**역할**: 상단 바 — 법인 선택 드롭다운, 사용자 정보, 로그아웃, 모바일 햄버거

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `onMenuClick` | `() => void` | 햄버거 버튼 클릭 → Layout의 드로어 오픈 |

## 구성 요소

```
[햄버거(모바일만)] [법인 드롭다운]      [이름] [role] [로그아웃]
```

## 법인 선택 동작

| 역할 | 표시 방식 |
|------|---------|
| `master` | 3법인 드롭다운 (선택 시 전체 앱 currentCompany 변경) |
| `ceo` | 3법인 드롭다운 |
| `company` | 텍스트만 표시 (선택 불가) |

## 법인 목록 상수

```typescript
const COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']
```
→ 법인 추가 시 이 배열 + `src/types/index.ts`의 `Company` 타입 동시 수정

## 변경 포인트

- **법인 추가**: `COMPANIES` 배열 + `Company` 타입 확장
- **햄버거 기준점**: `md:hidden` → `lg:hidden` 등 (Layout.tsx와 동기화)
- **사용자 이름 표시 기준**: `sm:inline` → 항상 표시하려면 클래스 제거
