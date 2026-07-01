import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config(
  // dist(빌드산출) + .claude/worktrees(에이전트 작업 사본)는 lint 대상 제외.
  // worktree 사본이 남아있으면 typescript-eslint가 tsconfigRootDir 후보를 다중 감지해
  // "No tsconfigRootDir was set" 파싱 에러로 lint 전체가 실패함.
  globalIgnores(['dist', '.claude/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      // ── React Hooks 핵심 규칙 (에러 유지) ──
      'react-hooks/rules-of-hooks':   'error',
      'react-hooks/exhaustive-deps':  'warn',
      // ── React Compiler 규칙 비활성화 ──────────────────────────────
      // react-hooks v7에 React Compiler 규칙이 추가됐으나 이 프로젝트는
      // React Compiler를 사용하지 않으므로 해당 규칙들을 끔.
      'react-hooks/immutability':       'off',  // useMemo 내 로컬 변수 재할당 허용
      'react-hooks/refs':               'off',  // 렌더 중 ref.current 갱신 허용 (latest-value 패턴)
      'react-hooks/purity':             'off',  // 렌더 중 impure 함수 호출 허용
      'react-hooks/error-boundaries':   'off',  // try/catch 내 JSX 허용
      'react-hooks/set-state-in-effect':'warn', // setState in effect: 에러 → 경고
      'react-hooks/void-use-memo':      'off',
      'react-hooks/use-memo':           'off',
      'react-hooks/no-deriving-state-in-effects': 'off',
      'react-hooks/preserve-manual-memoization': 'off',  // 수동 useCallback/useMemo deps 허용 (user?.sb_id 등 부분 dep)
      'react-hooks/incompatible-library':        'off',  // React Compiler 미사용
    },
  },
)