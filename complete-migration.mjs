import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLD_URL = process.env.OLD_VITE_SUPABASE_URL;
const OLD_KEY = process.env.OLD_VITE_SUPABASE_ANON_KEY;
const NEW_URL = process.env.VITE_SUPABASE_URL;
const NEW_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error('❌ Missing environment variables!');
  console.error('Required: OLD_VITE_SUPABASE_URL, OLD_VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

console.log('🚀 Starting complete database migration...\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

async function applyMigrations() {
  console.log('📋 Step 1: Applying all migrations...\n');

  const migrationsDir = join(__dirname, 'supabase', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files\n`);

  for (const file of files) {
    console.log(`  ▶ ${file}...`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    try {
      // Try to execute via RPC if available
      const response = await fetch(`${NEW_URL}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': NEW_KEY,
          'Authorization': `Bearer ${NEW_KEY}`
        },
        body: JSON.stringify({ sql_query: sql })
      });

      if (response.ok) {
        console.log(`    ✓ Applied`);
      } else {
        const text = await response.text();
        if (text.includes('already exists')) {
          console.log(`    ℹ️  Already applied`);
        } else {
          console.log(`    ⚠️  ${text.substring(0, 100)}`);
        }
      }
    } catch (err) {
      console.log(`    ⚠️  ${err.message.substring(0, 100)}`);
    }
  }

  console.log('\n✅ Migrations completed\n');
}

async function migrateData() {
  console.log('📦 Step 2: Migrating data...\n');

  const tables = [
    'customers',
    'addresses',
    'units',
    'unit_media',
    'pricing_rules',
    'orders',
    'order_items',
    'payments',
    'documents',
    'messages',
    'route_stops',
    'unit_inventory',
    'sms_conversations',
    'contacts',
    'invoices',
    'admin_settings',
    'sms_message_templates',
    'order_changelog',
    'order_discounts'
  ];

  for (const table of tables) {
    try {
      console.log(`  📤 ${table}...`);

      const { data: oldData, error: fetchError } = await oldDb
        .from(table)
        .select('*');

      if (fetchError) {
        console.log(`    ⚠️  Skip: ${fetchError.message}`);
        continue;
      }

      if (!oldData || oldData.length === 0) {
        console.log(`    ⏭️  Empty`);
        continue;
      }

      console.log(`    📥 Copying ${oldData.length} rows...`);

      const { error: insertError } = await newDb
        .from(table)
        .insert(oldData);

      if (insertError) {
        console.log(`    ⚠️  ${insertError.message.substring(0, 80)}`);
      } else {
        console.log(`    ✓ Done`);
      }
    } catch (err) {
      console.log(`    ⚠️  ${err.message}`);
    }
  }

  console.log('\n✅ Data migration completed\n');
}

async function verify() {
  console.log('🔍 Step 3: Verification...\n');

  const tables = ['customers', 'units', 'orders', 'contacts', 'invoices'];

  for (const table of tables) {
    try {
      const { count: oldCount } = await oldDb
        .from(table)
        .select('*', { count: 'exact', head: true });

      const { count: newCount } = await newDb
        .from(table)
        .select('*', { count: 'exact', head: true });

      const match = oldCount === newCount;
      console.log(`  ${match ? '✓' : '⚠️'} ${table}: ${oldCount || 0} → ${newCount || 0}`);
    } catch (err) {
      console.log(`  ⚠️  ${table}: ${err.message}`);
    }
  }

  console.log('\n✅ Verification completed\n');
}

async function main() {
  try {
    await applyMigrations();
    await migrateData();
    await verify();

    console.log('🎉 Migration completed!\n');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
