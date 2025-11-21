import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AccountOverview from './pages/AccountOverview'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'

function NotFound() {
  return (
    <div className="page">
      <h1>Page not found</h1>
      <p>The page you&apos;re looking for doesn&apos;t exist.</p>
      <a href="/">Go back home</a>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/account" element={<AccountOverview />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
