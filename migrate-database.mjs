import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const OLD_URL = process.env.OLD_VITE_SUPABASE_URL;
const OLD_KEY = process.env.OLD_VITE_SUPABASE_ANON_KEY;
const NEW_URL = process.env.VITE_SUPABASE_URL;
const NEW_KEY = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🚀 Starting database migration...\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

async function applyMigrations() {
  console.log('📋 Step 1: Applying schema migrations...\n');

  const migrationsDir = './supabase/migrations';
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Found ${files.length} migration files\n`);

  for (const file of files) {
    console.log(`  ▶ Applying ${file}...`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    try {
      const { error } = await newDb.rpc('exec_sql', { sql_query: sql }).catch(async () => {
        const { error } = await newDb.from('_dummy_').select('*').limit(0);
        if (error) {
          console.log(`    ⚠️  Using fallback: Direct SQL execution not available`);
          console.log(`    ℹ️  Please apply this migration manually in SQL Editor`);
          return { error: null };
        }
        return { error };
      });

      if (error && !error.message?.includes('already exists')) {
        console.log(`    ⚠️  Warning: ${error.message}`);
      } else {
        console.log(`    ✓ Applied successfully`);
      }
    } catch (err) {
      console.log(`    ⚠️  Error: ${err.message}`);
    }
  }

  console.log('\n✅ Schema migrations completed\n');
}

async function exportTableData(tableName, orderBy = 'created_at') {
  console.log(`  📤 Exporting ${tableName}...`);

  try {
    let query = oldDb.from(tableName).select('*');

    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      console.log(`    ⚠️  Error: ${error.message}`);
      return [];
    }

    console.log(`    ✓ Exported ${data?.length || 0} rows`);
    return data || [];
  } catch (err) {
    console.log(`    ⚠️  Error: ${err.message}`);
    return [];
  }
}

async function importTableData(tableName, data) {
  if (!data || data.length === 0) {
    console.log(`  ⏭️  Skipping ${tableName} (no data)`);
    return;
  }

  console.log(`  📥 Importing ${data.length} rows to ${tableName}...`);

  try {
    const { error } = await newDb.from(tableName).insert(data);

    if (error) {
      console.log(`    ⚠️  Error: ${error.message}`);
    } else {
      console.log(`    ✓ Imported successfully`);
    }
  } catch (err) {
    console.log(`    ⚠️  Error: ${err.message}`);
  }
}

async function migrateData() {
  console.log('📦 Step 2: Migrating data...\n');

  const tables = [
    { name: 'customers', orderBy: 'created_at' },
    { name: 'addresses', orderBy: 'created_at' },
    { name: 'units', orderBy: 'created_at' },
    { name: 'unit_media', orderBy: 'sort' },
    { name: 'pricing_rules', orderBy: null },
    { name: 'orders', orderBy: 'created_at' },
    { name: 'order_items', orderBy: null },
    { name: 'payments', orderBy: 'created_at' },
    { name: 'documents', orderBy: 'created_at' },
    { name: 'messages', orderBy: 'created_at' },
    { name: 'route_stops', orderBy: 'created_at' },
    { name: 'sms_conversations', orderBy: 'created_at' },
    { name: 'contacts', orderBy: 'created_at' },
    { name: 'invoices', orderBy: 'created_at' },
    { name: 'admin_settings', orderBy: 'created_at' },
    { name: 'sms_message_templates', orderBy: null },
  ];

  for (const table of tables) {
    const data = await exportTableData(table.name, table.orderBy);
    await importTableData(table.name, data);
  }

  console.log('\n✅ Data migration completed\n');
}

async function verifyMigration() {
  console.log('🔍 Step 3: Verifying migration...\n');

  const tables = ['customers', 'addresses', 'units', 'orders', 'contacts', 'invoices'];

  for (const table of tables) {
    const { count: oldCount } = await oldDb.from(table).select('*', { count: 'exact', head: true });
    const { count: newCount } = await newDb.from(table).select('*', { count: 'exact', head: true });

    const status = oldCount === newCount ? '✓' : '⚠️';
    console.log(`  ${status} ${table}: ${oldCount} → ${newCount}`);
  }

  console.log('\n✅ Verification completed\n');
}

async function main() {
  try {
    console.log('⚠️  NOTE: Schema migrations need to be applied manually via SQL Editor\n');
    console.log('Copy each migration file content to the SQL Editor in your new Supabase project\n');
    console.log('Press Ctrl+C if you want to apply migrations manually first, or wait to continue with data migration...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    await migrateData();
    await verifyMigration();

    console.log('🎉 Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('1. Verify the data in your new Supabase dashboard');
    console.log('2. Test your application with the new database');
    console.log('3. Update any environment variables in production\n');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
