# E1 financial and booking RPC test plan (not implemented, not executed)

D4 left the 122 DML statements inside function bodies unverified, because they run only when the functions are called. D4 executed `assign_role_by_email`, the signup trigger function and `order_net_financials`; it did not call the payment-operation, refund, booking or staff-save functions. This plan lists the minimum scenarios for release confidence and who should own each. Nothing here was run in E1.

Key fact from the D3 catalog: almost every function below is `SECURITY DEFINER` with EXECUTE granted to `service_role` only (the exceptions are `order_net_financials` and `order_refund_overview`, SECURITY INVOKER, executable by `authenticated` and `service_role`). So the database-level behaviour can be tested locally by switching to the `service_role` stub role (and setting JWT claims for the two `authenticated` functions) without Supabase Auth, PostgREST or Stripe, using synthetic provider ids.

## A. Tests possible with the existing local PostgreSQL fixtures (candidate stage: a future local-rehearsal step, not Step 2 hosted work)
Start from the D4 pre-upgrade fixture, apply the 67 migrations, then `SET ROLE service_role`.

| ID | Function(s) | Scenario | Expected result to assert |
|---|---|---|---|
| A1 | `claim_payment_operation`, `finalize_payment_operation`, `release_payment_operation` | claim a deposit operation on a confirmed order; finalize with a synthetic PaymentIntent; claim again | one open operation per order; amounts split into principal (deposit/balance) and tip that sum to the payment (cents); order paid columns change only in the finalize call; second claim while open is refused |
| A2 | same | claim then release without finalizing; stale lease | order paid columns unchanged; lease expires; the BEFORE UPDATE guard rejects changes to status, deposit/balance and tip while the lease is live |
| A3 | `record_payment_operation_provider`, `mark_payment_operation_provider_attempt` | write Checkout Session and PaymentIntent ids | duplicate Checkout Session or PaymentIntent rejected; null optional ids accepted |
| A4 | `payment_deposit_principal_state`, `record_offline_payment`, `record_cash_payment`, `record_check_payment` | cash and check deposits and balances including tip; deposit catch-up | deposit vs balance principal split exact in cents; payment parity between online and offline paths; refused for non-service callers |
| A5 | `reserve_refund_operation`, `reserve_refund_allocation`, `mark_refund_provider_attempt`, `record_refund_provider_result` | partial and full refund; two allocations across deposit/balance/tip; over-allocation by one cent | allocation sums equal the refund; over-refund and duplicate operation key refused; status transitions pending to succeeded or failed; reservation semantics (pending counted as reserved) |
| A6 | `apply_provider_refund_event`, `_apply_refund_transition` | provider event for an unknown refund; replayed event; legacy refund row | replay is a no-op; unknown refund handled without corrupting the ledger; legacy rows (NULL ledger version) keep legacy classification |
| A7 | `order_net_financials`, `order_refund_overview` | each D4 order incl. legacy refunds, as master, admin, crew, customer (JWT claims set with `set_config`) | exact integer-cent figures; NULL for crew and customers; anon cannot execute |
| A8 | `cancel_unattempted_payments_on_order_close`, `note_payment_applied_to_closed_order` | close an order with an unattempted pending payment, then apply a payment to a closed order | the unattempted payment is cancelled; the late payment is flagged, not silently applied |
| A9 | `guard_order_pricing_authority`, `apply_staff_order_save`, `create_staff_invoice_order` | staff save with a stale expected state; direct browser-style UPDATE of pricing columns; invoice order with discounts and custom fees | stale save refused; direct pricing UPDATE rejected for non-service sessions; server-computed totals equal the TypeScript pricing function for the same inputs (compare numbers, not formulas) |
| A10 | `create_booking_request`, `claim_booking_confirmation`, `finalize_booking_confirmation`, `release_booking_confirmation` | valid booking payload; payload with EE-only items (depends on decision U-5); duplicate submission with the same proof hash; confirmation claim race | one order per proof; consent rows written; confirmation claimed once; EE-only booking behaviour matches the owner's U-5 decision |
| A11 | `apply_balance_payment_financials`, `claim_balance_payment_financials`, `increment_order_refunded_cents` | webhook-style balance application twice with the same PaymentIntent | applied once (idempotent); cached order columns equal the ledger |

## B. Tests that need Supabase Auth or PostgREST
RLS evaluated under real JWTs (staff versus customer versus anon access to orders, payments, refunds, links and storage objects), PostgREST exposure of each RPC (anon cannot call service-role RPCs; `order_net_financials` returns NULL for non-admins), and `auth.uid()`-based `is_admin()` behaviour. Owner: Step 3 (security) with Step 4 (rehearsal on a hosted Development or preview branch, which is not authorized in Step 2).

## C. Tests that need Edge Functions or Stripe test mode
End-to-end checkout (deposit and balance), webhook-driven `apply_provider_refund_event`, refund creation through `stripe-refund`, `customer-cancel-order` writing its audit row with the service-role client, private-bucket signed URLs (`get-waiver-status`, evidence/portal functions, `useAdminPhotos`, `LotPicturesDisplay`), Realtime delivery. Owner: Step 4 (deploy-first rehearsal) and Step 6 (application release testing). Needs the Stripe test-mode keys the owner controls; no real provider call was or will be made in Step 2.

## D. Placement
- **Step 2 (migration correctness):** only A1-A5 and A11 are justified here, as they validate that the new SQL objects behave as the migrations claim. They require explicit authorization because E1 forbids executing tests.
- **Step 3:** B-class access and exposure tests, `supabase_admin` default-privilege review.
- **Step 4:** C-class deployment-order and Edge Function tests; U-5 behaviour for EE-only bookings.
- **Step 6:** payment and refund release testing in Stripe test mode.

## Minimum set for release confidence
A1, A2, A3, A5, A6, A7, A9, A10 and A11 (nine scenarios) cover payment authority, provider-id uniqueness, refund allocation, legacy classification, staff-save authority, booking creation and idempotent balance application; B-class access tests and C-class end-to-end tests are additional and cannot be replaced by the local ones.
