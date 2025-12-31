/*
  # Add Business Branding Settings

  1. New Settings in `admin_settings`
    - business_name - Legal business name for contracts and waivers
    - business_name_short - Short business name for display (SMS, emails)
    - business_legal_entity - Full legal entity name (e.g., "Company LLC")
    - business_address - Physical business address
    - business_phone - Primary business phone number
    - business_email - Primary business email
    - business_website - Business website URL
    - business_license_number - Business license/registration number (optional)

  2. Purpose
    - Enable white-label functionality
    - Allow business name to be configured dynamically
    - Remove hardcoded "Bounce Party Club" references
    - Support resale and licensing of the software

  3. Migration Strategy
    - Insert default values based on current "Bounce Party Club" setup
    - Values can be updated through Admin Settings UI
    - All templates and forms will use these settings dynamically
*/

-- Insert business branding settings with default values
INSERT INTO admin_settings (key, value, description) VALUES
('business_name', 'Bounce Party Club', 'Legal business name used in contracts, waivers, and official documents'),
('business_name_short', 'Bounce Party Club', 'Short business name for SMS, emails, and general display'),
('business_legal_entity', 'Bounce Party Club LLC', 'Full legal entity name including business structure (LLC, Inc, etc.)'),
('business_address', '123 Main St, Wayne, MI 48184', 'Physical business address for contracts and correspondence'),
('business_phone', '(313) 889-3860', 'Primary business phone number'),
('business_email', 'info@bouncepartyclub.com', 'Primary business email address'),
('business_website', 'https://bouncepartyclub.com', 'Business website URL'),
('business_license_number', '', 'Business license or registration number (optional)')
ON CONFLICT (key) DO NOTHING;
