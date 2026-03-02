# Google OAuth Autofill Fix

## Problem

Users who sign in with Google OAuth don't have their information autofilled in checkout forms because:

1. The auth trigger may not have created a customer record
2. Google OAuth provides limited information compared to email/password signup
3. Missing customer records mean the CustomerProfileContext has no data to autofill

## What Information Does Google OAuth Provide?

### Always Available:
- **Email address** - Primary identifier
- **Full name** - Usually in format "First Last"
- **Profile picture URL** - Avatar image

### Rarely/Never Available:
- **Phone number** - Only if user explicitly shares (rare)
- **Address** - Almost never (requires special OAuth scopes we don't request)
- **Business name** - Not provided by Google

### What We Extract:
```javascript
{
  email: "user@gmail.com",                    // ✅ Always
  full_name: "John Doe",                      // ✅ Usually
  name: "John Doe",                           // ✅ Usually (fallback)
  phone: "",                                  // ❌ Rarely
  picture: "https://lh3.googleusercontent..." // ✅ Usually
}
```

## The Fix

### 1. Automatic Customer Record Creation

When a user logs in with Google but has no customer record, the system now:

1. **Detects missing customer record** in `CustomerProfileContext`
2. **Calls backfill function** automatically
3. **Creates customer record** with available Google data:
   - First name (extracted from full_name)
   - Last name (extracted from full_name)
   - Email (from Google account)
   - Phone (empty - must be entered manually)
   - OAuth provider ("google")
   - OAuth profile data (stored for reference)

### 2. New Edge Function: `backfill-oauth-customers`

**Purpose**: Create missing customer records for OAuth users

**How it works**:
```typescript
// Extracts name from Google profile
const userName = user.user_metadata?.full_name ||
                 user.user_metadata?.name ||
                 user.email?.split('@')[0];

const nameParts = userName.split(' ');
const firstName = nameParts[0];
const lastName = nameParts.slice(1).join(' ');

// Creates customer record
await supabase.from('customers').insert({
  user_id: user.id,
  first_name: firstName,
  last_name: lastName,
  email: user.email,
  phone: '',  // Empty - will need to be filled in checkout
  oauth_provider: 'google',
  oauth_profile_data: user.user_metadata
});
```

### 3. Updated CustomerProfileContext

**Before**:
```typescript
if (!customerData) {
  return; // No customer = no autofill
}
```

**After**:
```typescript
if (!customerData) {
  // Attempt to backfill missing customer record
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/backfill-oauth-customers`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
      },
    }
  );

  if (response.ok) {
    // Reload profile with newly created customer
    await loadProfileAndDefaults(userId);
  }
}
```

## What Gets Autofilled for Google Users

### ✅ Automatically Filled:
- **First Name** - Extracted from Google full_name
- **Last Name** - Extracted from Google full_name
- **Email** - From Google account

### ❌ Must Be Entered Manually:
- **Phone Number** - Google doesn't share this
- **Address** - Google doesn't share this
- **Business Name** - Not provided by Google

## User Experience

### First Time Google Sign-In:
1. User clicks "Continue with Google"
2. Authenticates with Google
3. System automatically creates customer record
4. On next page load, name and email are autofilled
5. User must enter phone and address manually

### Subsequent Visits:
1. User signs in with Google
2. System loads existing customer record
3. Name and email autofilled
4. If user previously saved address/phone, those are autofilled too

### After First Order:
1. User completes first order with phone/address
2. That information is saved to customer record
3. On next visit, phone and address are also autofilled
4. User only needs to select date and items

## How to Improve Autofill for Google Users

### Option 1: Encourage Profile Completion
Add a prompt after Google sign-in:
```
"Complete your profile to speed up future bookings"
- Add phone number
- Add default address
```

### Option 2: Remember from First Order
The system already does this - after completing the first order:
- Phone number is saved
- Address is saved as default
- Future bookings autofill everything

### Option 3: Request Additional OAuth Scopes
We could request additional Google OAuth scopes:
- `https://www.googleapis.com/auth/user.phonenumbers.read`
- `https://www.googleapis.com/auth/user.addresses.read`

**However**:
- Most users won't grant these permissions
- Google marks apps requesting excessive scopes as "risky"
- Better to ask once in our own form than repeatedly in OAuth

## Testing the Fix

### For Existing Google Users:
1. Sign out
2. Clear browser cache (to reset profile context)
3. Sign in with Google
4. System will detect missing customer record
5. Automatically creates customer with name/email
6. Navigate to checkout - name and email should be filled

### For New Google Users:
1. Click "Continue with Google"
2. Complete Google OAuth
3. Navigate to checkout
4. First name, last name, and email should be autofilled
5. Phone and address fields will be empty (expected)

## Summary

**What works now**:
- Google OAuth users get automatic customer records
- Name and email autofill immediately
- Phone and address autofill after first order
- No manual intervention needed

**What users must do**:
- Enter phone number on first booking
- Enter address on first booking
- After that, everything autofills

**What's better than before**:
- Previously: Google users had NO autofill
- Now: Google users get name/email autofill immediately, full autofill after first order
- Automatic backfill fixes missing customer records

This provides the best balance of:
- User privacy (not requesting excessive OAuth scopes)
- User experience (autofill where possible)
- Data completeness (capture everything needed for orders)
