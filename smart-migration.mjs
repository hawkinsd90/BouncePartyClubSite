import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const OLD_URL = process.env.OLD_VITE_SUPABASE_URL;
const OLD_KEY = process.env.OLD_VITE_SUPABASE_ANON_KEY;
const NEW_URL = process.env.VITE_SUPABASE_URL;
const NEW_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

console.log('🚀 SMART DATABASE MIGRATION\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

// Correct order respecting foreign keys
const MIGRATION_ORDER = [
  // Step 1: Independent tables (no foreign keys)
  { name: 'user_roles', transform: null },
  { name: 'customers', transform: null },
  { name: 'units', transform: null },
  { name: 'admin_settings', strategy: 'skip' }, // Keep new settings
  { name: 'sms_message_templates', transform: null },
  { name: 'contacts', transform: null },

  // Step 2: Tables with FK to step 1
  { name: 'addresses', transform: null },
  { name: 'unit_media', transform: null },
  { name: 'sms_conversations', transform: null },

  // Step 3: Orders (remove incompatible columns)
  {
    name: 'orders',
    transform: (order) => {
      // Remove columns that don't exist in new schema
      const {
        on_the_way_at,
        arrived_at,
        setup_completed_at,
        pickup_completed_at,
        assigned_crew_id,
        customer_portal_token,
        tip_cents,
        ...rest
      } = order;
      return rest;
    }
  },

  // Step 4: Order-related tables
  { name: 'order_changelog', transform: null },
  { name: 'order_discounts', transform: null },
  { name: 'payments', transform: null },
  { name: 'messages', transform: null },
  { name: 'route_stops', transform: null },
  { name: 'documents', transform: null },
  { name: 'invoices', transform: null },
];

async function getTableData(tableName) {
  try {
    const { data, error } = await oldDb
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      if (error.code === '42P01') return { data: [], exists: false };
      throw error;
    }

    return { data: data || [], exists: true };
  } catch (err) {
    console.log(`    ⚠️ Error: ${err.message}`);
    return { data: [], exists: false };
  }
}

async function getExistingIds(tableName) {
  try {
    const { data, error } = await newDb
      .from(tableName)
      .select('id');

    if (error) return new Set();
    return new Set((data || []).map(row => row.id));
  } catch {
    return new Set();
  }
}

async function migrateTable(config) {
  const { name, transform, strategy } = config;

  console.log(`\n📦 ${name}`);

  if (strategy === 'skip') {
    const count = await getCount(newDb, name);
    console.log(`    ⏭️  Skipping (${count} records in new DB, preserving)`);
    return { success: true, skipped: true };
  }

  // Get old data
  const { data: oldData, exists } = await getTableData(name);

  if (!exists) {
    console.log(`    ⏭️  Table doesn't exist in old DB`);
    return { success: true, skipped: true };
  }

  if (oldData.length === 0) {
    console.log(`    ⏭️  No data in old DB`);
    return { success: true, skipped: true };
  }

  console.log(`    📤 Found ${oldData.length} records in old DB`);

  // Get existing IDs in new DB
  const existingIds = await getExistingIds(name);
  console.log(`    📊 ${existingIds.size} already exist in new DB`);

  // Filter and transform
  let toImport = oldData.filter(record => !existingIds.has(record.id));

  if (transform) {
    console.log(`    🔄 Transforming records...`);
    toImport = toImport.map(transform);
  }

  if (toImport.length === 0) {
    console.log(`    ✅ All records already migrated`);
    return { success: true, imported: 0, skipped: oldData.length };
  }

  console.log(`    📥 Importing ${toImport.length} new records...`);

  // Import in batches
  let imported = 0;
  let failed = 0;
  const batchSize = 50;

  for (let i = 0; i < toImport.length; i += batchSize) {
    const batch = toImport.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    try {
      const { error } = await newDb.from(name).insert(batch);

      if (error) {
        console.log(`    ❌ Batch ${batchNum}: ${error.message.substring(0, 100)}`);
        failed += batch.length;
      } else {
        imported += batch.length;
        if (toImport.length > 50) {
          process.stdout.write(`    📦 Progress: ${imported}/${toImport.length}\r`);
        }
      }
    } catch (err) {
      console.log(`    ❌ Batch ${batchNum}: ${err.message.substring(0, 100)}`);
      failed += batch.length;
    }
  }

  if (toImport.length > 50) console.log(); // New line after progress

  console.log(`    ✅ Imported: ${imported}, Failed: ${failed}`);

  return { success: failed === 0, imported, failed };
}

async function getCount(db, tableName) {
  try {
    const { count, error } = await db
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    return error ? 0 : (count || 0);
  } catch {
    return 0;
  }
}

async function verify() {
  console.log('\n\n🔍 VERIFICATION\n');

  const results = [];

  for (const config of MIGRATION_ORDER) {
    if (config.strategy === 'skip') continue;

    const oldCount = await getCount(oldDb, config.name);
    const newCount = await getCount(newDb, config.name);

    const status = newCount >= oldCount ? '✅' : '⚠️';
    const diff = newCount - oldCount;
    const diffStr = diff > 0 ? `(+${diff})` : diff < 0 ? `(${diff})` : '';

    console.log(`  ${status} ${config.name.padEnd(25)} ${String(oldCount).padStart(4)} → ${String(newCount).padStart(4)} ${diffStr}`);

    results.push({ table: config.name, oldCount, newCount, ok: newCount >= oldCount });
  }

  const allOk = results.every(r => r.ok);
  const totalOld = results.reduce((sum, r) => sum + r.oldCount, 0);
  const totalNew = results.reduce((sum, r) => sum + r.newCount, 0);

  console.log('\n' + '─'.repeat(60));
  console.log(`  TOTAL: ${totalOld} → ${totalNew}`);
  console.log('─'.repeat(60));

  return allOk;
}

async function main() {
  try {
    console.log('🎯 This migration will:');
    console.log('   • Respect foreign key dependencies');
    console.log('   • Transform incompatible schemas');
    console.log('   • Skip duplicate records');
    console.log('   • Preserve new database settings\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Migrate all tables in order
    for (const config of MIGRATION_ORDER) {
      await migrateTable(config);
    }

    // Verify
    const allOk = await verify();

    console.log('\n' + '═'.repeat(60));
    if (allOk) {
      console.log('✅ MIGRATION SUCCESSFUL!\n');
      console.log('All data has been successfully migrated.');
    } else {
      console.log('⚠️  MIGRATION COMPLETED WITH WARNINGS\n');
      console.log('Some tables have mismatched counts. Review above.');
    }
    console.log('═'.repeat(60));

    console.log('\n📋 Next Steps:');
    console.log('  1. Test your application');
    console.log('  2. Verify a few records in Supabase dashboard');
    console.log('  3. Once confirmed, remove OLD_* variables\n');

  } catch (err) {
    console.error('\n❌ MIGRATION FAILED:\n', err);
    process.exit(1);
  }
}

main();
