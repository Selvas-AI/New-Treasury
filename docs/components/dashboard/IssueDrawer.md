# IssueDrawer

**파일**: `src/components/dashboard/IssueDrawer.tsx`  
**신규 생성**: 2026-06-04

## 역할

헤더 이슈 전광판 ticker 클릭 시 나타나는 이슈 목록 플로팅 패널.  
기존 우측 패널 고정 카드인 `IssueCard`를 팝업 방식으로 전환한 것.

> **IssueCard 파일**: `src/components/dashboard/IssueCard.tsx`는 파일이 남아 있으나
> `DashboardPage`에서 더 이상 사용하지 않음. 향후 정리 예정.

## Props

```ts
interface Props {
  open:           boolean
  issues:         IssueItem[]
  activeKey:      string | null
  onStatusChange: (key: string, id: string, status: IssueStatus) => void
  onHover:        (key: string | null) => void
  onFocus:        (key: string | null) => void
  onClose:        () => void
}
```

## 기능

| 기능 | 설명 |
|------|------|
| 이슈 목록 | 미완료 이슈 전체 표시 (done 포함) |
| 상태 변경 | 미조치 / 검토중 / 완료 버튼 클릭 → `onStatusChange` 호출 |
| 바로가기 | 이슈 유형별 페이지 이동 (input/loans/equity) |
| 전체 이력 | `/issue-history` 이동 버튼 |
| 이슈 배지 | 헤더에 미완료 이슈 수 빨간 배지 표시 |

## 열기/닫기

```ts
// DashboardPage 상태
const [issueOpen, setIssueOpen] = useState(false)

// 헤더 ticker 클릭
onClick={() => setIssueOpen(prev => !prev)}

// 닫기: ✕ 버튼 | 배경 딤 클릭 | ticker 재클릭
```

## 위치 및 애니메이션

`FlowDetailDrawer`와 동일:
```
fixed right-4 top-1/2 -translate-y-1/2  z-50
w-80  max-h-[70vh]
animate-[slideInRight_0.2s_ease-out]
```

> **동시 열림 주의**: `FlowDetailDrawer`와 `IssueDrawer`가 동시에 열릴 수 있음.
> 두 패널이 같은 `right-4 top-1/2` 위치를 공유하므로 겹침 가능.
> 추후 필요 시 상호 배타적 상태로 처리 권장.
