// Fixed facts and explicit rules of the Production -> Development order data refresh.
//
// Everything that decides WHAT is replaced lives here, as named lists, so a reviewer can read the scope in one place. The tool
// never derives scope by "copy everything that matches": a table not named here is never touched, and a dependency the lists do
// not account for stops the run (see analyze.mjs).

export const PROJECTS = {
  prod: { label: 'Production', ref: 'qaagfafagdpgzcijnfbw' },
  dev: { label: 'Development', ref: 'srxunxiytojjsuhcmzjg' },
};

// Scratch databases (local PostgreSQL used by tests and rehearsals) are recognised by name AND by being on this machine.
export const SCRATCH_DB_PREFIX = 'devrefresh_';
export const SCRATCH_HOSTS = ['127.0.0.1', 'localhost', '::1'];

// ---------------------------------------------------------------------------------------------------------------------
// Tables whose rows are REPLACED (deleted from Development, then loaded from Production), parents before children.
// ---------------------------------------------------------------------------------------------------------------------
export const REPLACE_TABLES = [
  // customer / contact / address roots
  'customers',
  'addresses',
  'contacts',
  // the order and everything that belongs to it
  'orders',
  'billing_addresses',
  'order_signatures',
  'order_items',
  'order_discounts',
  'order_custom_fees',
  'order_notes',
  'order_changelog',
  'order_workflow_events',
  // money history
  'payments',
  'order_refunds',
  'transaction_receipts',
  'invoices',
  'invoice_links',
  'consent_records',
  // fulfilment
  'task_status',
  'route_stops',
  'crew_location_history',
  // messages
  'documents',
  'messages',
  'sms_conversations',
  // evidence rows (database rows only; Storage objects are never touched)
  'order_pictures',
  'order_lot_pictures',
  'address_lot_pictures',
];

// Foreign keys that point "forward" in the order above (a circular reference). Their columns are inserted as NULL and filled in
// by an UPDATE once every referenced row exists. Verified against the live foreign-key catalog on every run.
export const DEFERRED_COLUMNS = {
  customers: ['default_address_id'], // customers <-> addresses
  orders: ['signature_id'], // orders <-> order_signatures
  payments: ['refunded_payment_id'], // payments -> payments (a refund row points at an earlier payment)
};

// Development-only tables whose rows hang off an order with ON DELETE CASCADE. They are emptied together with the orders they
// belong to (their rows are meaningless without the order) and there is nothing to import into them.
export const CLEARED_WITH_ORDERS = ['order_portal_links', 'booking_setup_proofs'];

// ---------------------------------------------------------------------------------------------------------------------
// Column rules
// ---------------------------------------------------------------------------------------------------------------------
// Reusable Stripe instruments of an order. A Production customer / payment method id means nothing to Development's Stripe TEST
// account, yet the application reads "customer id AND payment method id present" as "a card is saved" (hasSavedCard in
// _shared/orders/lifecycle-outcome.ts, has_saved_card in the portal projection) and would try to charge it. They are NOT copied;
// the application already supports the empty state (orderChangePlanning sets stripe_payment_method_id to null; checkout creates a
// fresh Stripe customer). The originals are written to the run's quarantine file, outside the database.
// Ledger references (payments / transaction_receipts / order_refunds payment-intent, charge, refund, session ids) are history, not
// reusable instruments, and several unique indexes are built on them, so they are copied unchanged.
export const QUARANTINED_STRIPE_COLUMNS = {
  orders: ['stripe_customer_id', 'stripe_payment_method_id', 'payment_method_id'],
};

// Values forced on import, with the reason. A Production order captured mid-payment would otherwise be locked forever in
// Development, where no such payment is in flight.
export const FORCED_VALUES = {
  orders: { payment_lock: { sql: 'false', reason: 'a Production payment in flight at export time can never complete in Development' } },
};

// Customer ownership. customers.user_id is the portal ownership link (public.current_customer_ids()). It is kept ONLY when the
// identity relationship is demonstrable and unique; see analyze.mjs / sqlgen.mjs (rules A and B). Never blindly reassigned.
export const CUSTOMER_OWNER_TABLE = 'customers';
export const CUSTOMER_OWNER_COLUMN = 'user_id';

// A reference from an UNCHANGED table to a replaced row that PostgreSQL sets to NULL when the row is deleted
// (ON DELETE SET NULL). The tool remembers those references and puts them back when the same row exists after the import.
// An extra condition (SQL over c = the child row, k = the remembered value) can demand more evidence than an equal id.
export const RESTORE_CONDITIONS = {
  // customer_profiles.contact_id grants portal access to that contact's customer (current_customer_ids()). Put it back only when
  // the signed-in user's own email is the contact's email.
  'customer_profiles.contact_id':
    "EXISTS (SELECT 1 FROM auth.users u JOIN public.contacts ct ON ct.id = k.val WHERE u.id = c.user_id AND lower(u.email) = lower(ct.email))",
};

// ---------------------------------------------------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------------------------------------------------
// Application triggers on the replaced tables are switched off for the duration of the transaction (and only those, and only by
// name: foreign keys, unique, check and not-null constraints stay enforced) because the Production rows are already the result
// of those triggers having run in Production; running them again would re-derive, duplicate or reject history. Each is reviewed
// here. A trigger that is NOT listed stops the run: somebody added behaviour this tool has not been reviewed against.
export const REVIEWED_TRIGGERS = {
  'contacts.update_contacts_updated_at': 'timestamp on UPDATE',
  'invoices.update_invoices_updated_at': 'timestamp on UPDATE',
  'invoice_links.update_invoice_links_timestamp': 'timestamp on UPDATE',
  'invoice_links.trg_invoice_links_enforce_revocation': 'portal-link revocation rule on write; imported links are already consistent',
  'order_portal_links.trg_order_portal_links_updated_at': 'timestamp on UPDATE (table is emptied, not imported)',
  'orders.trg_cancel_unattempted_payments_on_order_close': 'would cancel payment rows when an order closes; Production already did',
  'orders.trg_guard_order_pricing_authority': 'pricing authority guard for application writes; imported rows are Production truth',
  'orders.trg_guard_payment_authoritative_order_changes': 'payment authority guard for application writes; imported rows are Production truth',
  'orders.trg_sync_invoice_links_expires_at': 'would rewrite imported invoice link expiry',
  'orders.trigger_auto_create_task_status': 'would create tasks; tasks are imported from Production',
  'orders.trigger_update_contact_stats': 'would recompute contact statistics; contacts are imported with theirs',
  'orders.update_contact_stats_trigger': 'would recompute contact statistics; contacts are imported with theirs',
  'orders.validate_status_transition': 'validates a status CHANGE; an INSERT of finished history must not be re-validated',
  'payments.payments_updated_at_trigger': 'timestamp on UPDATE',
  'payments.update_payments_updated_at': 'timestamp on UPDATE',
  'payments.trg_note_payment_applied_to_closed_order': 'would write order notes; notes are imported from Production',
  'task_status.trigger_auto_update_order_status': 'would change order status from task rows; orders are imported with their status',
  'transaction_receipts.update_transaction_receipts_timestamp': 'timestamp on UPDATE',
};

// ---------------------------------------------------------------------------------------------------------------------
// "Nothing else changed" evidence
// ---------------------------------------------------------------------------------------------------------------------
// High-churn tables written by ordinary website traffic; excluded from the before/after fingerprint of unchanged tables.
export const CHURN_TABLES = ['site_events', 'rate_limits', 'auth_trigger_logs', 'google_calendar_sync_queue', 'notification_failures', 'notification_system_status'];

export const TOOL_VERSION = 1;
export const EXPORT_MAX_AGE_HOURS = 24;
