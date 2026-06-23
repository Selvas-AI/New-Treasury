/**
 * usePageCompany — 페이지 회사 컨텍스트 단일화 훅 (D2)
 *
 * 배경: "URL :company param + AuthContext.currentCompany + 기본법인" 을 종합해
 *   현재 회사를 산출하고 URL↔컨텍스트를 동기화하는 로직이 9개 페이지에 제각각
 *   복제돼 있었다(fallback·검증·역할 처리가 미묘하게 달라 일관성 저하).
 *   AuthContext.currentCompany 가 이미 단일 소스이므로, 이를 감싸 페이지 공통
 *   해석·동기화만 한 곳으로 모은다.
 *
 * 동작:
 *   - company        : 유효한 URL param 우선, 없으면 currentCompany, 그래도 없으면 첫 활성 법인
 *   - URL param 유효 시 currentCompany 와 다르면 컨텍스트에 동기화(effect)
 *   - setCompany(c)  : 컨텍스트 갱신 + basePath 주어지면 `${basePath}/${c}` 로 URL replace
 *
 * 사용:
 *   const { company, setCompany } = usePageCompany('/daily-report-list')
 *   // 탭 버튼 onClick={() => setCompany(c)}
 *   // basePath 가 /:company/:date 처럼 추가 세그먼트를 가지면 basePath 생략하고
 *   // 페이지가 자체 navigate 로 처리(예: DailyReportPage).
 */
import { useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from './useAuth'
import { getCompanyNames } from './useCompanies'
import type { Company } from '../types'

export function usePageCompany(basePath?: string): {
  company: Company
  paramCompany: string | undefined
  setCompany: (c: Company) => void
} {
  const { company: paramCompany } = useParams<{ company?: string }>()
  const navigate = useNavigate()
  const { currentCompany, setCurrentCompany, hasCompany } = useAuth()

  const names    = getCompanyNames()
  const fallback = (currentCompany ?? names.find(n => hasCompany(n as Company)) ?? names[0] ?? '셀바스에이아이') as Company

  // 권한 있는 법인 param 만 수용 (직접 URL 로 미권한 법인 진입 차단)
  const paramAllowed = !!paramCompany && names.includes(paramCompany) && hasCompany(paramCompany as Company)
  const company: Company = paramAllowed ? (paramCompany as Company) : fallback

  // URL param → 컨텍스트 동기화 (권한 있는 param 이 바뀔 때만)
  useEffect(() => {
    if (paramAllowed && paramCompany !== currentCompany) {
      setCurrentCompany(paramCompany as Company)
    }
    // names/currentCompany 는 매 렌더 새 참조라 deps 제외 — param 변화만 트리거
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramCompany])

  const setCompany = useCallback((c: Company) => {
    setCurrentCompany(c)
    if (basePath) navigate(`${basePath}/${c}`, { replace: true })
  }, [basePath, navigate, setCurrentCompany])

  return { company, paramCompany, setCompany }
}
