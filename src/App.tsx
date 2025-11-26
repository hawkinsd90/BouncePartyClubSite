import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Catalog } from './pages/Catalog';
import { UnitDetail } from './pages/UnitDetail';
import { Quote } from './pages/Quote';
import { Contact } from './pages/Contact';
import { Checkout } from './pages/Checkout';
import { About } from './pages/About';
import { Admin } from './pages/Admin';
import { Crew } from './pages/Crew';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Invoice } from './pages/Invoice';
import { PaymentComplete } from './pages/PaymentComplete';
import { PaymentCanceled } from './pages/PaymentCanceled';
import { UnitForm } from './pages/UnitForm';
import { CustomerPortal } from './pages/CustomerPortal';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/invoice/:orderId" element={<Invoice />} />
          <Route path="/customer-portal/:orderId" element={<CustomerPortal />} />
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
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
