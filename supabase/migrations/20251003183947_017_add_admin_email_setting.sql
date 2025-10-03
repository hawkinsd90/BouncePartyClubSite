/*
  # Add Admin Email Setting

  1. Changes
    - Add admin_email setting to admin_settings table for error notifications
    - Default value is deveehawk@gmail.com
  
  2. Security
    - Uses existing RLS policies for admin_settings table
*/

INSERT INTO admin_settings (key, value, description)
VALUES ('admin_email', 'deveehawk@gmail.com', 'Admin email address for error notifications and alerts')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, description = EXCLUDED.description;