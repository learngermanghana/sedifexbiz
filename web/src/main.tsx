import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import App from './App'
import ShellLayout from './layout/ShellLayout'
import Dashboard from './pages/Dashboard'
import MarketplaceOrders from './pages/MarketplaceOrdersV2'
import DashboardHub from './pages/DashboardHub'
import Products from './pages/ProductsWorkspace'
import Sell from './pages/Sell'
import QuickPay from './pages/QuickPay'
import QuickPayPrint from './pages/QuickPayPrint'
import PublicQuickPayCheckout from './pages/PublicQuickPayCheckout'
import PublicQuickPayReceipt from './pages/PublicQuickPayReceipt'
import PublicCustomerPortal from './pages/PublicCustomerPortal'
import PublicWebsiteEngine from './pages/PublicWebsiteEngine'
import PublicEventContractPage from './pages/PublicEventContract'
import CloseDay from './pages/CloseDay'
import Customers from './pages/Customers'
import CustomerCRM from './pages/CustomerCRM'
import Students from './pages/Students'
import Bookings from './pages/Bookings'
import EventPlanningRoute from './pages/EventPlanningRoute'
import EventWorkspace from './pages/EventWorkspace'
import BookingEditor from './pages/BookingEditor'
import BookingsAvailability from './pages/BookingsAvailability'
import StudentRegistration from './pages/StudentRegistration'
import VolunteerApplications from './pages/VolunteerApplications'
import Support from './pages/Support'
import SupportRequests from './pages/SupportRequests'
import ReportsHome from './pages/reports/ReportsHome'
import InventoryReport from './pages/reports/InventoryReport'
import PosSalesReport from './pages/reports/PosSalesReport'
import WebsiteSalesReport from './pages/reports/WebsiteSalesReport'
import BookingsReport from './pages/reports/BookingsReport'
import StudentRegistrationsReport from './pages/reports/StudentRegistrationsReport'
import VolunteersReport from './pages/reports/VolunteersReport'
import DonorsReport from './pages/reports/DonorsReport'
import FundsReport from './pages/reports/FundsReport'
import BlogReport from './pages/reports/BlogReport'
import SettlementReport from './pages/reports/SettlementReport'
import Logi from './pages/Logi'
import Onboarding from './pages/Onboarding'
import CleanAccountOverview from './pages/CleanAccountOverview'
import PaymentSettlement from './pages/PaymentSettlement'
import BulkMessaging from './pages/BulkMessaging'
import BulkEmail from './pages/BulkEmail'
import StaffManagement from './pages/StaffManagement'
import { BillingVerifyPage } from './pages/BillingVerifyPage'
import Expenses from './pages/Expenses'
import FundsLedger from './pages/FundsLedger'
import DocumentsGenerator from './pages/DocumentsGenerator'
import DocumentsBuilder from './pages/DocumentsBuilder'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import InventorySystemGhana from './pages/InventorySystemGhana'
import InventoryManagementSoftwareGhana from './pages/InventoryManagementSoftwareGhana'
import EventManagementSoftware from './pages/EventManagementSoftware'
import WeddingPlanningSoftware from './pages/WeddingPlanningSoftware'
import EventManagementSoftwareGhana from './pages/EventManagementSoftwareGhana'
import PricingPage from './pages/PricingPage'
import DataTransfer from './pages/DataTransfer'
import PromoLandingPage from './pages/PromoLandingPage'
import PromoSettings from './pages/PromoSettings'
import GallerySettings from './pages/GallerySettings'
import WebsiteHeroSlides from './pages/WebsiteHeroSlides'
import SocialLinksSettings from './pages/SocialLinksSettings'
import WebsiteBuilder from './pages/WebsiteBuilder'
import BookingMappingSettings from './pages/BookingMappingSettings'
import IntegrationWebsiteSettings from './pages/IntegrationWebsiteSettings'
import IntegrationBookingsSettings from './pages/IntegrationBookingsSettings'
import IntegrationEmailSettings from './pages/IntegrationEmailSettings'
import AutomationCenter from './pages/AutomationCenter'
import BlogPage from './pages/BlogPage'
import ReceiptView from './pages/ReceiptView'
import CustomerDisplay from './pages/CustomerDisplay'
import PublicCustomerIntake from './pages/PublicCustomerIntake'
import PrivacyPage from './pages/legal/PrivacyPage'
import CookiesPage from './pages/legal/CookiesPage'
import RefundPage from './pages/legal/RefundPage'
import TermsPage from './pages/legal/TermsPage'
import ReturnPolicyPage from './pages/legal/ReturnPolicyPage'
import IntegrationQuickstartPage from './pages/docs/IntegrationQuickstartPage'
import StudentRegistrationIntegrationPage from './pages/docs/StudentRegistrationIntegrationPage'
import WordpressInstallGuidePage from './pages/docs/WordpressInstallGuidePage'
import BulkEmailGoogleSheetsPage from './pages/docs/BulkEmailGoogleSheetsPage'
import HowToUseSedifexPage from './pages/docs/HowToUseSedifexPage'
import DonorWebsiteIntegrationPage from './pages/docs/DonorWebsiteIntegrationPage'
import PublicBlogPage from './pages/PublicBlogPage'
import { ToastProvider } from './components/ToastProvider'
import './studentRegistrationTabs.css'

const SalesCashReport = React.lazy(() => import('./pages/reports/SalesCashReport'))
const BusinessExpenses = React.lazy(() => import('./pages/BusinessExpenses'))

function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<main className="workspace-page"><section className="workspace-card"><p className="workspace-muted">Loading page…</p></section></main>}>
      {children}
    </Suspense>
  )
}

const router = createBrowserRouter([
  { path: '/receipt/:saleId', element: <ReceiptView /> },
  { path: '/quick-pay/receipt/:storeId/:reference', element: <PublicQuickPayReceipt /> },
  { path: '/event-contract/:token', element: <PublicEventContractPage /> },
  { path: '/customer-portal/:token', element: <PublicCustomerPortal /> },
  { path: '/promo/:slug', element: <PromoLandingPage /> },
  { path: '/login', element: <Navigate to="/" replace /> },
  { path: '/s/:storeId', element: <PublicQuickPayCheckout /> },
  { path: '/sites/:slug/:pageSlug', element: <PublicWebsiteEngine /> },
  { path: '/sites/:slug', element: <PublicWebsiteEngine /> },
  { path: '/:slug', element: <PromoLandingPage /> },
  { path: '/customer-display', element: <CustomerDisplay /> },
  { path: '/display', element: <CustomerDisplay /> },
  { path: '/join-customers/:inviteId', element: <PublicCustomerIntake /> },
  { path: '/join-customers/:inviteId/:mode', element: <PublicCustomerIntake /> },
  { path: '/public-blog/:storeId', element: <PublicBlogPage /> },
  { path: '/public-blog/:storeId/:slug', element: <PublicBlogPage /> },
  { path: '/', element: <App />, children: [
    { element: <ShellLayout />, children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardHub />, children: [{ index: true, element: <Dashboard /> }] },
      { path: 'reports', element: <ReportsHome /> },
      { path: 'reports/sales-cash', element: <LazyPage><SalesCashReport /></LazyPage> },
      { path: 'reports/inventory', element: <InventoryReport /> },
      { path: 'reports/sales', element: <Navigate to="/reports/pos-sales" replace /> },
      { path: 'reports/pos-sales', element: <PosSalesReport /> },
      { path: 'reports/website-sales', element: <WebsiteSalesReport /> },
      { path: 'reports/settlement', element: <SettlementReport /> },
      { path: 'reports/bookings', element: <BookingsReport /> },
      { path: 'reports/student-registrations', element: <StudentRegistrationsReport /> },
      { path: 'reports/volunteers', element: <VolunteersReport /> },
      { path: 'reports/donors', element: <DonorsReport /> },
      { path: 'reports/funds', element: <FundsReport /> },
      { path: 'reports/blog', element: <BlogReport /> },
      { path: 'products', element: <Products /> },
      { path: 'products/new', element: <Products /> },
      { path: 'sell', element: <Sell /> },
      { path: 'quick-pay', element: <QuickPay /> },
      { path: 'quick-pay/print', element: <QuickPayPrint /> },
      { path: 'customers', element: <CustomerCRM /> },
      { path: 'customers/manage', element: <Customers /> },
      { path: 'customers/:customerId', element: <CustomerCRM /> },
      { path: 'students', element: <Students /> },
      { path: 'bookings', element: <Bookings /> },
      { path: 'event-planning', element: <EventPlanningRoute /> },
      { path: 'event-planning/:eventId', element: <EventWorkspace /> },
      { path: 'bookings/new', element: <BookingEditor /> },
      { path: 'bookings/availability', element: <Navigate to="/upcoming-events" replace /> },
      { path: 'upcoming-events', element: <BookingsAvailability /> },
      { path: 'bookings/:bookingId', element: <BookingEditor /> },
      { path: 'online-orders', element: <MarketplaceOrders /> },
      { path: 'marketplace-orders', element: <MarketplaceOrders /> },
      { path: 'product-engagement', element: <Navigate to="/dashboard" replace /> },
      { path: 'student-registration', element: <StudentRegistration /> },
      { path: 'volunteers', element: <VolunteerApplications /> },
      { path: 'support-requests', element: <SupportRequests /> },
      { path: 'data-transfer', element: <DataTransfer /> },
      { path: 'bulk-messaging', element: <BulkMessaging /> },
      { path: 'bulk-email', element: <BulkEmail /> },
      { path: 'logi', element: <Logi /> },
      { path: 'sell/invoice', element: <DocumentsGenerator /> },
      { path: 'invoices', element: <DocumentsBuilder mode="invoice" /> },
      { path: 'receipts', element: <DocumentsBuilder mode="receipt" /> },
      { path: 'finance', element: <Navigate to="/sell/invoice" replace /> },
      { path: 'finance/documents', element: <Navigate to="/sell/invoice" replace /> },
      { path: 'expenses', element: <LazyPage><BusinessExpenses /></LazyPage> },
      { path: 'donor-management', element: <Expenses /> },
      { path: 'funds-ledger', element: <FundsLedger /> },
      { path: 'settlement', element: <PaymentSettlement /> },
      { path: 'sell/close-day', element: <CloseDay /> },
      { path: 'close-day', element: <Navigate to="/sell/close-day" replace /> },
      { path: 'onboarding', element: <Onboarding /> },
      { path: 'staff', element: <StaffManagement /> },
      { path: 'account', element: <CleanAccountOverview /> },
      { path: 'account/overview', element: <CleanAccountOverview /> },
      { path: 'public-page', element: <Navigate to="/account" replace /> },
      { path: 'website-builder', element: <WebsiteBuilder /> },
      { path: 'promo', element: <PromoSettings /> },
      { path: 'gallery', element: <GallerySettings /> },
      { path: 'website-hero-slides', element: <WebsiteHeroSlides /> },
      { path: 'social-links', element: <SocialLinksSettings /> },
      { path: 'merchant-feed', element: <Navigate to="/sell" replace /> },
      { path: 'support', element: <Support /> },
      { path: 'blog', element: <BlogPage /> },
      { path: 'settings/automations', element: <AutomationCenter /> },
      { path: 'settings/integrations/booking-mapping', element: <BookingMappingSettings /> },
      { path: 'settings/integrations/website', element: <IntegrationWebsiteSettings /> },
      { path: 'settings/integrations/bookings', element: <IntegrationBookingsSettings /> },
      { path: 'settings/integrations/email', element: <IntegrationEmailSettings /> },
    ]},
    { path: 'reset-password', element: <ResetPassword /> },
    { path: 'verify-email', element: <VerifyEmail /> },
    { path: 'billing/verify', element: <BillingVerifyPage /> },
    { path: 'inventory-system-ghana', element: <InventorySystemGhana /> },
    { path: 'inventory-management-software-ghana', element: <InventoryManagementSoftwareGhana /> },
    { path: 'event-management-software', element: <EventManagementSoftware /> },
    { path: 'wedding-planning-software', element: <WeddingPlanningSoftware /> },
    { path: 'event-management-software-ghana', element: <EventManagementSoftwareGhana /> },
    { path: 'pricing', element: <PricingPage /> },
    { path: 'docs/integration-quickstart', element: <IntegrationQuickstartPage /> },
    { path: 'docs/student-registration-integration', element: <StudentRegistrationIntegrationPage /> },
    { path: 'docs/wordpress-install-guide', element: <WordpressInstallGuidePage /> },
    { path: 'docs/bulk-email-google-sheets-guide', element: <BulkEmailGoogleSheetsPage /> },
    { path: 'docs/how-to-use-sedifex', element: <HowToUseSedifexPage /> },
    { path: 'docs/donor-website-integration', element: <DonorWebsiteIntegrationPage /> },
    { path: 'legal/privacy', element: <PrivacyPage /> },
    { path: 'legal/cookies', element: <CookiesPage /> },
    { path: 'legal/refund', element: <RefundPage /> },
    { path: 'legal/terms', element: <TermsPage /> },
    { path: 'privacy', element: <PrivacyPage /> },
    { path: 'cookies', element: <CookiesPage /> },
    { path: 'refund', element: <RefundPage /> },
    { path: 'terms', element: <TermsPage /> },
    { path: 'return-policy', element: <ReturnPolicyPage /> },
  ]},
])

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </React.StrictMode>,
)