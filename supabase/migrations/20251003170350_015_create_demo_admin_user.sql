/*
  # Create Demo Admin User

  This migration creates a demo admin user for testing purposes.
  
  1. Changes
    - Creates admin user with email: admin@bouncepartyclub.com
    - Password: admin123
    - Adds ADMIN role to user_roles table
  
  2. Security
    - User is created with confirmed email
    - Role is properly set in user_roles table
*/

DO $$
DECLARE
  admin_user_id uuid;
BEGIN
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    'admin@bouncepartyclub.com',
    crypt('admin123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"ADMIN"}'::jsonb,
    '{"role":"ADMIN"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
  RETURNING id INTO admin_user_id;

  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    admin_user_id,
    admin_user_id::text,
    format('{"sub":"%s","email":"admin@bouncepartyclub.com"}', admin_user_id)::jsonb,
    'email',
    now(),
    now(),
    now()
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (admin_user_id, 'ADMIN')
  ON CONFLICT (user_id, role) DO NOTHING;
  
END $$;
