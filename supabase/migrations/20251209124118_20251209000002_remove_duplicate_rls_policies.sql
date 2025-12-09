-- Remove Duplicate RLS Policies
-- This removes the older duplicate policies while keeping the optimized versions

-- Remove old admin_settings policies (keep the optimized ones)
DROP POLICY IF EXISTS "Admin users can insert settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can read settings" ON admin_settings;
DROP POLICY IF EXISTS "Admin users can update settings" ON admin_settings;

-- Remove old contacts policies (keep the newer ADMIN/MASTER versions)
DROP POLICY IF EXISTS "Admin users can read all contacts" ON contacts;
DROP POLICY IF EXISTS "Admin users can insert contacts" ON contacts;
DROP POLICY IF EXISTS "Admin users can update contacts" ON contacts;

-- Remove old invoices policies (keep the newer ADMIN/MASTER versions)
DROP POLICY IF EXISTS "Admin users can read all invoices" ON invoices;
DROP POLICY IF EXISTS "Admin users can insert invoices" ON invoices;
DROP POLICY IF EXISTS "Admin users can update invoices" ON invoices;

-- Remove old sms_conversations policies (keep the newer ADMIN/MASTER versions)
DROP POLICY IF EXISTS "Admin users can read SMS conversations" ON sms_conversations;
DROP POLICY IF EXISTS "Admin users can insert SMS conversations" ON sms_conversations;
