import { Navigate, useParams } from 'react-router-dom';
import { portalPathForCurrentVisitor } from '../lib/portal/portalToken';

// The old /invoice/view/:orderId page read and wrote orders directly from the browser. It is gone. Old emailed links and
// bookmarks land here and are sent to the Customer Portal, which asks for the order's secure link (or sends a new one)
// instead of trusting the order id in the URL.
export function LegacyInvoiceRedirect() {
  const { orderId } = useParams<{ orderId: string }>();
  if (!orderId) return <Navigate to="/" replace />;
  return <Navigate to={portalPathForCurrentVisitor(orderId)} replace />;
}
