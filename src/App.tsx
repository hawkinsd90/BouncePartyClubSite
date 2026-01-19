import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { BusinessProvider } from './contexts/BusinessContext';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Layout } from './components/common/Layout';
import { Home } from './pages/Home';

const Catalog = lazy(() => import('./pages/Catalog').then(m => ({ default: m.Catalog })));
const UnitDetail = lazy(() => import('./pages/UnitDetail').then(m => ({ default: m.UnitDetail })));
const Quote = lazy(() => import('./pages/Quote').then(m => ({ default: m.Quote })));
const Contact = lazy(() => import('./pages/Contact').then(m => ({ default: m.Contact })));
const Checkout = lazy(() => import('./pages/Checkout').then(m => ({ default: m.Checkout })));
const About = lazy(() => import('./pages/About').then(m => ({ default: m.About })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Crew = lazy(() => import('./pages/Crew').then(m => ({ default: m.Crew })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Setup = lazy(() => import('./pages/Setup').then(m => ({ default: m.Setup })));
const Invoice = lazy(() => import('./pages/Invoice').then(m => ({ default: m.Invoice })));
const PaymentComplete = lazy(() => import('./pages/PaymentComplete').then(m => ({ default: m.PaymentComplete })));
const PaymentCanceled = lazy(() => import('./pages/PaymentCanceled').then(m => ({ default: m.PaymentCanceled })));
const UnitForm = lazy(() => import('./pages/UnitForm').then(m => ({ default: m.UnitForm })));
const CustomerPortal = lazy(() => import('./pages/CustomerPortal').then(m => ({ default: m.CustomerPortal })));
const CustomerDashboard = lazy(() => import('./pages/CustomerDashboard').then(m => ({ default: m.CustomerDashboard })));
const Sign = lazy(() => import('./pages/Sign'));
const InvoicePreview = lazy(() => import('./pages/InvoicePreview').then(m => ({ default: m.InvoicePreview })));
const MenuPreview = lazy(() => import('./pages/MenuPreview').then(m => ({ default: m.MenuPreview })));


function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <BusinessProvider>
          <AuthProvider>
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-slate-600">Loading...</p>
            </div>
          </div>
        }>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/invoice/:token" element={<CustomerPortal />} />
          <Route path="/invoice/view/:orderId" element={<Invoice />} />
          <Route path="/invoice-preview" element={<InvoicePreview />} />
          <Route path="/menu-preview" element={<MenuPreview />} />
          <Route path="/sign/:orderId" element={<Sign />} />
          <Route path="/customer-portal/:orderId" element={<CustomerPortal />} />
          <Route path="/customer-portal" element={<CustomerPortal />} />
          <Route path="/checkout/payment-complete" element={<PaymentComplete />} />
          <Route path="/checkout/payment-canceled" element={<PaymentCanceled />} />
          <Route path="/checkout/:orderId" element={<Checkout />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="catalog" element={<Catalog />} />
            <Route path="units/:slug" element={<UnitDetail />} />
            <Route path="quote" element={<Quote />} />
            <Route path="contact" element={<Contact />} />
            <Route path="checkout" element={<Checkout />} />
            <Route path="about" element={<About />} />
            <Route
              path="my-orders"
              element={
                <ProtectedRoute allowedRoles={['CUSTOMER', 'ADMIN', 'CREW', 'MASTER']}>
                  <CustomerDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/inventory/new"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <UnitForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin/inventory/edit/:id"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <UnitForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="crew/*"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'CREW']}>
                  <Crew />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
        </Suspense>
          </AuthProvider>
        </BusinessProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
