# Authentication Setup for Bounce Party Club

## Test Users

For development and testing, create the following users in Supabase Dashboard:

### Admin User
- **Email:** admin@bouncepartyclub.com
- **Password:** admin123
- **User Metadata:**
  ```json
  {"role": "ADMIN"}
  ```

### Crew User
- **Email:** crew@bouncepartyclub.com
- **Password:** crew123
- **User Metadata:**
  ```json
  {"role": "CREW"}
  ```

## How to Create Users

1. Go to your Supabase Dashboard
2. Navigate to Authentication > Users
3. Click "Add user" (or "Invite user")
4. Enter the email and password
5. In the "User Metadata" section, add the role JSON as shown above
6. Save the user

## Role Permissions

- **ADMIN**: Full access to Admin dashboard and Crew app
- **CREW**: Access to Crew app only

## Implementation Notes

- Roles are stored in `user_metadata.role` field in Supabase Auth
- The app checks roles via the `useAuth()` hook
- Protected routes use the `<ProtectedRoute>` component
- Navigation links (Admin/Crew) are conditionally shown based on user role
