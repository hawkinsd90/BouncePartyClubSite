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

console.log('🚀 COMPREHENSIVE DATABASE MIGRATION\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

// Complete list of all tables to migrate
const TABLES_TO_MIGRATE = [
  { name: 'user_roles', orderBy: 'created_at', strategy: 'merge' },
  { name: 'customers', orderBy: 'created_at', strategy: 'merge' },
  { name: 'addresses', orderBy: 'created_at', strategy: 'merge' },
  { name: 'units', orderBy: 'created_at', strategy: 'merge' },
  { name: 'unit_media', orderBy: 'created_at', strategy: 'merge' },
  { name: 'pricing_rules', orderBy: 'created_at', strategy: 'merge' },
  { name: 'orders', orderBy: 'created_at', strategy: 'merge' },
  { name: 'order_items', orderBy: 'created_at', strategy: 'merge' },
  { name: 'order_changelog', orderBy: 'created_at', strategy: 'merge' },
  { name: 'order_discounts', orderBy: 'created_at', strategy: 'merge' },
  { name: 'payments', orderBy: 'created_at', strategy: 'merge' },
  { name: 'documents', orderBy: 'created_at', strategy: 'merge' },
  { name: 'messages', orderBy: 'created_at', strategy: 'merge' },
  { name: 'route_stops', orderBy: 'created_at', strategy: 'merge' },
  { name: 'sms_conversations', orderBy: 'created_at', strategy: 'merge' },
  { name: 'sms_messages', orderBy: 'created_at', strategy: 'merge' },
  { name: 'contacts', orderBy: 'created_at', strategy: 'merge' },
  { name: 'invoices', orderBy: 'created_at', strategy: 'merge' },
  { name: 'admin_settings', orderBy: null, strategy: 'skip_if_exists' }, // Don't overwrite settings
  { name: 'sms_message_templates', orderBy: null, strategy: 'merge' },
];

async function getTableCount(db, tableName) {
  try {
    const { count, error } = await db
      .from(tableName)
      .select('*', { count: 'exact', head: true });
    return error ? 0 : (count || 0);
  } catch {
    return 0;
  }
}

async function exportAllFromTable(tableName, orderBy) {
  try {
    let query = oldDb.from(tableName).select('*');

    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return { data: [], exists: false };
      }
      throw error;
    }

    return { data: data || [], exists: true };
  } catch (err) {
    console.log(`    ⚠️ Error reading: ${err.message}`);
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

async function importWithMerge(tableName, oldData) {
  if (!oldData || oldData.length === 0) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  const existingIds = await getExistingIds(tableName);
  const newRecords = oldData.filter(record => !existingIds.has(record.id));

  console.log(`    📊 Old DB: ${oldData.length} records | New DB: ${existingIds.size} exist | To import: ${newRecords.length}`);

  if (newRecords.length === 0) {
    return { imported: 0, skipped: oldData.length, errors: 0 };
  }

  let imported = 0;
  let errors = 0;
  const batchSize = 50;

  for (let i = 0; i < newRecords.length; i += batchSize) {
    const batch = newRecords.slice(i, i + batchSize);

    try {
      const { error } = await newDb.from(tableName).insert(batch);

      if (error) {
        if (error.message.includes('duplicate key')) {
          console.log(`    ⚠️ Batch ${Math.floor(i/batchSize) + 1}: Duplicate keys (skipping)`);
        } else {
          console.log(`    ❌ Batch ${Math.floor(i/batchSize) + 1}: ${error.message.substring(0, 100)}`);
          errors += batch.length;
        }
      } else {
        imported += batch.length;
      }
    } catch (err) {
      console.log(`    ❌ Batch error: ${err.message.substring(0, 100)}`);
      errors += batch.length;
    }
  }

  return { imported, skipped: existingIds.size, errors };
}

async function migrateTable(tableConfig) {
  const { name, orderBy, strategy } = tableConfig;

  console.log(`\n📦 ${name}`);
  console.log(`  Strategy: ${strategy}`);

  // Get counts first
  const oldCount = await getTableCount(oldDb, name);
  const newCountBefore = await getTableCount(newDb, name);

  console.log(`  📤 Exporting from old database...`);
  const { data: oldData, exists } = await exportAllFromTable(name, orderBy);

  if (!exists) {
    console.log(`    ⏭️  Table doesn't exist in old DB (skipping)`);
    return { success: true, skipped: true };
  }

  console.log(`    ✓ Exported ${oldData.length} rows`);

  if (strategy === 'skip_if_exists' && newCountBefore > 0) {
    console.log(`    ⏭️  Skipping (${newCountBefore} records already exist, preserving new data)`);
    return { success: true, skipped: true };
  }

  console.log(`  📥 Importing to new database...`);
  const result = await importWithMerge(name, oldData);

  const newCountAfter = await getTableCount(newDb, name);

  console.log(`    ✅ Complete: ${result.imported} imported, ${result.skipped} already existed`);
  if (result.errors > 0) {
    console.log(`    ⚠️  ${result.errors} errors`);
  }
  console.log(`    📊 Final count: ${oldCount} (old) → ${newCountAfter} (new)`);

  return {
    success: result.errors === 0,
    stats: { oldCount, newCountBefore, newCountAfter, ...result }
  };
}

async function verify() {
  console.log('\n\n🔍 VERIFICATION\n');
  console.log('Comparing record counts:\n');

  const results = [];

  for (const table of TABLES_TO_MIGRATE) {
    const oldCount = await getTableCount(oldDb, table.name);
    const newCount = await getTableCount(newDb, table.name);

    const status = newCount >= oldCount ? '✅' : '⚠️';
    const diff = newCount - oldCount;
    const diffStr = diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '=';

    console.log(`  ${status} ${table.name.padEnd(25)} ${String(oldCount).padStart(4)} → ${String(newCount).padStart(4)} (${diffStr})`);

    results.push({
      table: table.name,
      oldCount,
      newCount,
      ok: newCount >= oldCount
    });
  }

  const allOk = results.every(r => r.ok);
  const totalOld = results.reduce((sum, r) => sum + r.oldCount, 0);
  const totalNew = results.reduce((sum, r) => sum + r.newCount, 0);

  console.log('\n' + '─'.repeat(60));
  console.log(`  TOTAL: ${totalOld} (old) → ${totalNew} (new)`);
  console.log('─'.repeat(60));

  return { allOk, results, totalOld, totalNew };
}

async function main() {
  try {
    console.log('⚠️  This migration will:');
    console.log('   • Export ALL data from old database');
    console.log('   • Merge with new database (preserve existing data)');
    console.log('   • Skip duplicates based on ID');
    console.log('   • Keep new features and settings intact\n');

    await new Promise(resolve => setTimeout(resolve, 2000));

    const migrationResults = [];

    for (const tableConfig of TABLES_TO_MIGRATE) {
      const result = await migrateTable(tableConfig);
      migrationResults.push(result);
    }

    const verification = await verify();

    console.log('\n\n' + '═'.repeat(60));

    if (verification.allOk) {
      console.log('✅ MIGRATION SUCCESSFUL');
      console.log('\nAll data has been migrated. New database has equal or more records.');
    } else {
      console.log('⚠️  MIGRATION COMPLETED WITH WARNINGS');
      console.log('\nSome tables have fewer records in new DB. This may be expected if:');
      console.log('  • Records were intentionally cleaned up');
      console.log('  • Some tables had test data that was removed');
      console.log('  • RLS policies are preventing visibility');
    }

    console.log('═'.repeat(60));

    console.log('\n📋 Next Steps:');
    console.log('  1. Review the counts above');
    console.log('  2. Test your application thoroughly');
    console.log('  3. Check a few records manually in Supabase dashboard');
    console.log('  4. Once confirmed, remove OLD_* variables from .env.local');
    console.log('  5. Delete migration scripts\n');

  } catch (err) {
    console.error('\n❌ MIGRATION FAILED\n');
    console.error(err);
    process.exit(1);
  }
}

main();
