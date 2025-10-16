import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const OLD_URL = process.env.OLD_VITE_SUPABASE_URL;
const OLD_KEY = process.env.OLD_VITE_SUPABASE_ANON_KEY;
const NEW_URL = process.env.VITE_SUPABASE_URL;
const NEW_KEY = process.env.VITE_SUPABASE_ANON_KEY;

console.log('🚀 Starting data migration...\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error('❌ Missing environment variables!');
  console.error('Make sure .env has OLD_VITE_SUPABASE_URL, OLD_VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

async function exportTable(tableName, orderBy = 'created_at') {
  console.log(`  📤 Exporting ${tableName}...`);

  try {
    let query = oldDb.from(tableName).select('*');

    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      if (error.message.includes('does not exist')) {
        console.log(`    ⏭️  Table doesn't exist yet (skipping)`);
        return [];
      }
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

async function importTable(tableName, data) {
  if (!data || data.length === 0) {
    console.log(`  ⏭️  No data to import for ${tableName}`);
    return true;
  }

  console.log(`  📥 Importing ${data.length} rows to ${tableName}...`);

  const batchSize = 100;
  let imported = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);

    try {
      const { error } = await newDb.from(tableName).insert(batch);

      if (error) {
        if (error.message.includes('duplicate key') || error.message.includes('already exists')) {
          console.log(`    ⚠️  Some records already exist (skipping duplicates)`);
        } else {
          console.log(`    ⚠️  Error in batch ${i / batchSize + 1}: ${error.message}`);
          return false;
        }
      } else {
        imported += batch.length;
      }
    } catch (err) {
      console.log(`    ⚠️  Error: ${err.message}`);
      return false;
    }
  }

  console.log(`    ✓ Imported ${imported} rows successfully`);
  return true;
}

async function migrateTable(tableName, orderBy = 'created_at') {
  console.log(`\n📦 Migrating ${tableName}...`);
  const data = await exportTable(tableName, orderBy);
  const success = await importTable(tableName, data);
  return success;
}

async function verifyMigration() {
  console.log('\n\n🔍 Verifying migration...\n');

  const tables = ['customers', 'addresses', 'units', 'orders', 'contacts', 'invoices', 'sms_conversations'];

  let allMatch = true;

  for (const table of tables) {
    try {
      const { count: oldCount } = await oldDb.from(table).select('*', { count: 'exact', head: true });
      const { count: newCount } = await newDb.from(table).select('*', { count: 'exact', head: true });

      const status = oldCount === newCount ? '✅' : '⚠️';
      console.log(`  ${status} ${table}: ${oldCount} → ${newCount}`);

      if (oldCount !== newCount) {
        allMatch = false;
      }
    } catch (err) {
      console.log(`  ⚠️  ${table}: Could not verify (${err.message})`);
    }
  }

  return allMatch;
}

async function main() {
  try {
    console.log('⚠️  IMPORTANT: Make sure you have applied all schema migrations first!\n');
    console.log('Continue in 3 seconds...\n');

    await new Promise(resolve => setTimeout(resolve, 3000));

    const tablesToMigrate = [
      { name: 'customers', orderBy: 'created_at' },
      { name: 'addresses', orderBy: 'created_at' },
      { name: 'units', orderBy: 'created_at' },
      { name: 'unit_media', orderBy: 'sort' },
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

    for (const table of tablesToMigrate) {
      await migrateTable(table.name, table.orderBy);
    }

    const allMatch = await verifyMigration();

    console.log('\n' + '='.repeat(50));
    if (allMatch) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with warnings');
      console.log('Some tables may have mismatched counts - please verify manually');
    }
    console.log('='.repeat(50) + '\n');

    console.log('Next steps:');
    console.log('1. Check your new Supabase dashboard to verify data');
    console.log('2. Test the application');
    console.log('3. Once confirmed working, you can remove the OLD_* env variables\n');
  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
