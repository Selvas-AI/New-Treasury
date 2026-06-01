# Layout

**파일**: `src/components/Layout.tsx`  
**역할**: 전체 앱 레이아웃 (Sidebar + TopBar + 콘텐츠 영역), 미인증 리다이렉트

---

## 구조

```
┌──────────────────────────────────────────┐
│ [Sidebar]  │  [TopBar]                   │
│            ├─────────────────────────────│
│  w-56      │  <main>                     │
│  (접힘:    │    <Outlet />               │  ← React Router 페이지
│   w-14)    │  </main>                    │
└──────────────────────────────────────────┘
```

## 상태 관리

| 상태 | 저장소 | 설명 |
|------|--------|------|
| `collapsed` | `localStorage('sidebar_collapsed')` | PC 사이드바 접기 상태 |
| `drawerOpen` | React state | 모바일 드로어 열림 상태 |

## 반응형 분기점

- `md` (768px) 기준
- PC(`≥768px`): 사이드바 고정, 접기 버튼으로 토글
- 모바일(`<768px`): 사이드바 숨김(-translate-x-full), 햄버거 클릭 시 슬라이드인

## 미인증 처리

```typescript
if (!user) return <Navigate to="/login" replace />
```

## 변경 포인트

- **반응형 분기점 변경**: `md` → `lg` 등 Tailwind 클래스 수정
- **사이드바 기본 너비**: `w-56` 변경 (Sidebar.tsx의 `w` 변수도 동기화)
- **TopBar 높이**: `h-14` → `h-16` 등 (main 패딩 자동 적용)
