import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import InputPage from './pages/InputPage'
import InvestPage from './pages/InvestPage'
import LoansPage from './pages/LoansPage'
import EquityPage from './pages/EquityPage'
import HistoryPage from './pages/HistoryPage'
import IssueHistoryPage from './pages/IssueHistoryPage'
import FxPage from './pages/FxPage'
import MyCodePage from './pages/admin/MyCodePage'
import UsersPage from './pages/admin/UsersPage'
import DataPage from './pages/admin/DataPage'

/**
 * 라우팅 구조
 *
 * 모든 데이터 페이지는 /페이지/:company?/:id? 형태로 딥링크를 지원합니다.
 * 외부 시스템이 특정 법인·종목·차입건의 URL을 직접 링크할 수 있습니다.
 *
 * 예시:
 *   /loans/셀바스에이아이               → 셀바스에이아이 차입금 목록
 *   /equity/셀바스헬스케어/삼성전자     → 특정 종목 상세
 *   /bonds/메디아나/KR1234567890       → 특정 ISIN 국채 상세
 *   /daily/셀바스에이아이/2026-05-29   → 특정 날짜 운전자금
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/New-Treasury">
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<Layout />}>
            {/* 기본 진입점 */}
            <Route index element={<Navigate to="/dashboard" replace />} />

            {/* 통합 상황판 */}
            <Route path="/dashboard"           element={<DashboardPage />} />
            <Route path="/dashboard/:company"  element={<DashboardPage />} />

            {/* 운전자금 */}
            <Route path="/input"                element={<InputPage />} />
            <Route path="/input/:company"       element={<InputPage />} />
            <Route path="/input/:company/:date" element={<InputPage />} />

            {/* 운용자금 */}
            <Route path="/invest"              element={<InvestPage />} />
            <Route path="/invest/:company"     element={<InvestPage />} />
            <Route path="/invest/:company/:id" element={<InvestPage />} />

            {/* 차입금 */}
            <Route path="/loans"              element={<LoansPage />} />
            <Route path="/loans/:company"     element={<LoansPage />} />
            <Route path="/loans/:company/:id" element={<LoansPage />} />

            {/* 지분투자 + 국채 */}
            <Route path="/equity"              element={<EquityPage />} />
            <Route path="/equity/:company"     element={<EquityPage />} />
            <Route path="/equity/:company/:name" element={<EquityPage />} />
            <Route path="/bonds"               element={<EquityPage />} />
            <Route path="/bonds/:company"      element={<EquityPage />} />
            <Route path="/bonds/:company/:isin" element={<EquityPage />} />

            {/* 자금변동이력 */}
            <Route path="/history"                    element={<HistoryPage />} />
            <Route path="/history/:company"           element={<HistoryPage />} />
            <Route path="/history/:company/:from/:to" element={<HistoryPage />} />

            {/* 이슈이력 */}
            <Route path="/issue-history"           element={<IssueHistoryPage />} />
            <Route path="/issue-history/:issueKey" element={<IssueHistoryPage />} />

            {/* 환율 */}
            <Route path="/fx"           element={<FxPage />} />
            <Route path="/fx/:currency" element={<FxPage />} />

            {/* 관리 */}
            <Route path="/admin/mycode" element={<MyCodePage />} />
            <Route path="/admin/users"  element={<UsersPage />} />
            <Route path="/admin/data"   element={<DataPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
