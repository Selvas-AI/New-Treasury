# Sidebar

**파일**: `src/components/Sidebar.tsx`  
**역할**: 다크 사이드바 네비게이션 (PC 접기, 모바일 드로어)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `collapsed` | `boolean` | 접힌 상태 (Layout에서 관리) |
| `onCollapse` | `() => void` | 접기 버튼 클릭 콜백 |
| `onNavClick` | `() => void` | 메뉴 클릭 시 콜백 (모바일 드로어 닫기용) |

## 메뉴 구성

```
NAV_ITEMS (일반 메뉴)
─────────────────────
⊞  통합 상황판   /dashboard
✏️  운전자금 입력  /input
📈  운용자금       /invest
🏦  차입금         /loans
💹  지분/장기투자  /equity
📋  자금 변동 이력 /history
🔔  이슈 이력      /issue-history
💱  환율 현황      /fx

ADMIN_ITEMS (master 역할만 표시)
─────────────────────────────────
🔑  코드 변경      /admin/mycode
👥  사용자 관리    /admin/users
🗄️  데이터 관리    /admin/data
```

## collapsed 모드

- `w-14` (56px), 아이콘만 표시
- `title` 속성으로 마우스 호버 시 메뉴명 툴팁
- 현재 이모지 아이콘 사용 (Tabler Icons 교체 가능)

## 활성 메뉴 스타일

```typescript
// NavLink isActive 시
'bg-blue-600 text-white'
// 비활성 시
'hover:bg-gray-700 hover:text-white'
```

## 변경 포인트

- **메뉴 추가**: `NAV_ITEMS` 배열에 항목 추가 + App.tsx 라우트 추가
- **아이콘 교체**: `icon` 필드를 이모지 → `@tabler/icons-react` 컴포넌트로 교체
- **관리 메뉴 권한**: `user?.role === 'master'` 조건 수정 (ceo도 일부 허용 시)
- **메뉴 색상**: `bg-gray-900` (배경), `bg-blue-600` (활성) 수정
