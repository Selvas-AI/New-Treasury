-- closed_date_migration.sql
-- 세션20차 — 차입금/운용자금 상환·만기처리 시점의 "닫힌 날짜"를 저장.
--
-- 배경: loans/investments 테이블은 상환/만기처리 시 새 row를 추가하지 않고
-- 기존 row의 active 플래그만 false로 바꿔 재사용한다. 이 때문에 자금 변동
-- 이력(대시보드 "현금흐름 추이" 차트)이 "그 시점 이전에는 활성 상태였는지"를
-- 판별할 방법이 없어, 상환 후 조회하면 과거 날짜의 잔액에도 상환된 금액이
-- 소급 반영되어 보이는 문제가 있었다 (세션19차 → 세션20차에서 근본 수정).
--
-- closed_date = active를 false로 바꾼 날짜. active=true로 복원하면 다시 NULL.
-- NULL = 계속 활성 상태(또는 한 번도 닫힌 적 없음).

ALTER TABLE loans       ADD COLUMN IF NOT EXISTS closed_date date;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS closed_date date;

COMMENT ON COLUMN loans.closed_date       IS '상환처리(active=false)된 날짜. NULL=계속 활성';
COMMENT ON COLUMN investments.closed_date IS '만기처리(active=false)된 날짜. NULL=계속 활성';
