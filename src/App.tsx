import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthProvider from './contexts/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import PlaceholderPage from './pages/PlaceholderPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/New-Treasury">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"     element={<DashboardPage />} />
            <Route path="/input"         element={<PlaceholderPage title="운전자금 입력"   step="Step 11" />} />
            <Route path="/invest"        element={<PlaceholderPage title="운용자금"        step="Step 12" />} />
            <Route path="/loans"         element={<PlaceholderPage title="차입금"          step="Step 13" />} />
            <Route path="/equity"        element={<PlaceholderPage title="지분/장기투자"   step="Step 14" />} />
            <Route path="/history"       element={<PlaceholderPage title="자금 변동 이력"  step="Step 15" />} />
            <Route path="/issue-history" element={<PlaceholderPage title="이슈 이력"       step="Step 16" />} />
            <Route path="/fx"            element={<PlaceholderPage title="환율 현황"       step="Step 17" />} />
            <Route path="/admin/mycode"  element={<PlaceholderPage title="코드 변경"       step="Step 18" />} />
            <Route path="/admin/users"   element={<PlaceholderPage title="사용자 관리"     step="Step 18" />} />
            <Route path="/admin/data"    element={<PlaceholderPage title="데이터 관리"     step="Step 18" />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
