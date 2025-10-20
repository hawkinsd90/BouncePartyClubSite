# Database Migration Guide

This guide will help you migrate from your old Supabase project to the new one.

## Overview

- **Old Database**: `ohtxfkaswaocdwbpyztr.supabase.co`
- **New Database**: `qaagfafagdpgzcijnfbw.supabase.co`

## Migration Steps

### Step 1: Apply Schema Migrations

You need to apply all 38 migration files to your new database. Here's how:

1. **Go to your new Supabase project**:
   - Navigate to: https://supabase.com/dashboard/project/qaagfafagdpgzcijnfbw/sql/new

2. **Apply each migration file** in order:
   - The files are in `supabase/migrations/` folder
   - Apply them in chronological order (they're numbered 001 through 038)
   - Copy the SQL content and paste it into the SQL Editor
   - Click "Run" for each migration

**Important migrations to apply (in order)**:

```
001_create_core_schema.sql          ← Core tables
002_seed_sample_units.sql           ← Sample data
004_add_new_order_fields.sql
005_update_home_base_wayne_mi.sql
006_add_unit_inventory.sql
007_add_availability_check_function.sql
008_add_admin_settings.sql
009_add_sms_conversations.sql       ← SMS table
010_add_contacts_and_invoices.sql   ← Contacts & Invoices
...
[Continue through all migrations]
...
038_add_wet_mode_images_and_dimensions.sql
```

**Alternative: Apply All at Once**

Copy all migration files' contents into one large SQL script and run it all at once in the SQL Editor.

### Step 2: Run Data Migration

Once the schema is ready, migrate the data:

```bash
node migrate-data.mjs
```

This script will:
- Export all data from the old database
- Import it into the new database
- Verify the migration by comparing row counts

### Step 3: Verify

1. Check your new Supabase dashboard: https://supabase.com/dashboard/project/qaagfafagdpgzcijnfbw/editor
2. You should see all tables populated with data
3. Verify a few records manually

### Step 4: Test Application

1. The `.env` file is already updated with new credentials
2. Test the application locally:
   ```bash
   npm run dev
   ```
3. Verify all features work correctly

### Step 5: Cleanup

Once everything is confirmed working:
1. Remove `OLD_VITE_SUPABASE_URL` and `OLD_VITE_SUPABASE_ANON_KEY` from `.env`
2. Delete the old Supabase project (optional)
3. Delete migration scripts: `migrate-data.mjs`, `MIGRATION_GUIDE.md`

## Tables to Migrate

The following tables will be migrated:

- ✅ customers
- ✅ addresses
- ✅ units
- ✅ unit_media
- ✅ orders
- ✅ order_items
- ✅ payments
- ✅ documents
- ✅ messages
- ✅ route_stops
- ✅ sms_conversations
- ✅ contacts
- ✅ invoices
- ✅ admin_settings
- ✅ sms_message_templates

## Troubleshooting

### "Table does not exist"

Make sure you applied all schema migrations first (Step 1).

### "Duplicate key value"

Some data might already exist. The script will skip duplicates automatically.

### "Permission denied"

Make sure you're using the anon key (not service role key) in your `.env` file.

### Row counts don't match

Check the SQL Editor for any errors during migration. Some tables might have RLS policies that need to be temporarily disabled.

## Need Help?

If you encounter issues:
1. Check the new Supabase project logs
2. Verify all migrations were applied successfully
3. Check RLS policies are configured correctly
4. Try running the data migration script again (it's safe to re-run)
