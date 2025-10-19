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

console.log('🚀 FINAL COMPREHENSIVE MIGRATION\n');
console.log(`📤 From: ${OLD_URL}`);
console.log(`📥 To: ${NEW_URL}\n`);

const oldDb = createClient(OLD_URL, OLD_KEY);
const newDb = createClient(NEW_URL, NEW_KEY);

// Map old IDs to new IDs for foreign key relationships
const idMappings = {
  customers: {},
  units: {},
  addresses: {},
  orders: {},
};

async function getTableData(tableName, orderBy = 'created_at') {
  try {
    let query = oldDb.from(tableName).select('*');
    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01') return { data: [], exists: false };
      throw error;
    }

    return { data: data || [], exists: true };
  } catch (err) {
    return { data: [], exists: false };
  }
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

// STEP 1: Migrate customers (match by email)
async function migrateCustomers() {
  console.log('\n📦 customers');

  const { data: oldCustomers } = await getTableData('customers');
  if (!oldCustomers || oldCustomers.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${oldCustomers.length} in old DB`);

  // Get existing customers by email
  const { data: newCustomers } = await newDb.from('customers').select('id, email');
  const emailToId = {};
  (newCustomers || []).forEach(c => emailToId[c.email] = c.id);

  let imported = 0;

  for (const customer of oldCustomers) {
    if (emailToId[customer.email]) {
      // Already exists, map IDs
      idMappings.customers[customer.id] = emailToId[customer.email];
    } else {
      // Insert new customer
      const { data, error } = await newDb
        .from('customers')
        .insert(customer)
        .select('id')
        .single();

      if (!error && data) {
        idMappings.customers[customer.id] = data.id;
        imported++;
      } else if (error && error.message.includes('duplicate')) {
        // Race condition, fetch the existing one
        const { data: existing } = await newDb
          .from('customers')
          .select('id')
          .eq('email', customer.email)
          .single();
        if (existing) {
          idMappings.customers[customer.id] = existing.id;
        }
      }
    }
  }

  console.log(`    ✅ Imported: ${imported}, Mapped: ${Object.keys(idMappings.customers).length}`);
  return { imported };
}

// STEP 2: Migrate units (match by slug)
async function migrateUnits() {
  console.log('\n📦 units');

  const { data: oldUnits } = await getTableData('units');
  if (!oldUnits || oldUnits.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${oldUnits.length} in old DB`);

  // Get existing units by slug
  const { data: newUnits } = await newDb.from('units').select('id, slug');
  const slugToId = {};
  (newUnits || []).forEach(u => slugToId[u.slug] = u.id);

  let imported = 0;

  for (const unit of oldUnits) {
    if (slugToId[unit.slug]) {
      idMappings.units[unit.id] = slugToId[unit.slug];
    } else {
      const { data, error } = await newDb
        .from('units')
        .insert(unit)
        .select('id')
        .single();

      if (!error && data) {
        idMappings.units[unit.id] = data.id;
        imported++;
      } else if (error && error.message.includes('duplicate')) {
        const { data: existing } = await newDb
          .from('units')
          .select('id')
          .eq('slug', unit.slug)
          .single();
        if (existing) {
          idMappings.units[unit.id] = existing.id;
        }
      }
    }
  }

  console.log(`    ✅ Imported: ${imported}, Mapped: ${Object.keys(idMappings.units).length}`);
  return { imported };
}

// STEP 3: Migrate addresses (remap customer_id)
async function migrateAddresses() {
  console.log('\n📦 addresses');

  const { data: oldAddresses } = await getTableData('addresses');
  if (!oldAddresses || oldAddresses.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${oldAddresses.length} in old DB`);

  const { data: existingIds } = await newDb.from('addresses').select('id');
  const existing = new Set((existingIds || []).map(a => a.id));

  let imported = 0;

  for (const address of oldAddresses) {
    if (existing.has(address.id)) {
      idMappings.addresses[address.id] = address.id;
      continue;
    }

    // Remap customer_id
    const newCustomerId = idMappings.customers[address.customer_id];
    if (!newCustomerId) {
      continue; // Skip if customer doesn't exist
    }

    const { data, error } = await newDb
      .from('addresses')
      .insert({ ...address, customer_id: newCustomerId })
      .select('id')
      .single();

    if (!error && data) {
      idMappings.addresses[address.id] = data.id;
      imported++;
    }
  }

  console.log(`    ✅ Imported: ${imported}, Mapped: ${Object.keys(idMappings.addresses).length}`);
  return { imported };
}

// STEP 4: Migrate unit_media (remap unit_id)
async function migrateUnitMedia() {
  console.log('\n📦 unit_media');

  const { data: oldMedia } = await getTableData('unit_media', 'created_at');
  if (!oldMedia || oldMedia.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${oldMedia.length} in old DB`);

  const { data: existingIds } = await newDb.from('unit_media').select('id');
  const existing = new Set((existingIds || []).map(m => m.id));

  let imported = 0;

  for (const media of oldMedia) {
    if (existing.has(media.id)) continue;

    const newUnitId = idMappings.units[media.unit_id];
    if (!newUnitId) continue;

    const { error } = await newDb
      .from('unit_media')
      .insert({ ...media, unit_id: newUnitId });

    if (!error) imported++;
  }

  console.log(`    ✅ Imported: ${imported}`);
  return { imported };
}

// STEP 5: Migrate orders (remap customer_id, address_id, remove incompatible columns)
async function migrateOrders() {
  console.log('\n📦 orders');

  const { data: oldOrders } = await getTableData('orders');
  if (!oldOrders || oldOrders.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${oldOrders.length} in old DB`);

  const { data: existingIds } = await newDb.from('orders').select('id');
  const existing = new Set((existingIds || []).map(o => o.id));

  let imported = 0;

  for (const order of oldOrders) {
    if (existing.has(order.id)) {
      idMappings.orders[order.id] = order.id;
      continue;
    }

    // Remap foreign keys
    const newCustomerId = idMappings.customers[order.customer_id];
    const newAddressId = idMappings.addresses[order.address_id];

    if (!newCustomerId) continue; // Skip if customer doesn't exist

    // Remove incompatible columns
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

    const newOrder = {
      ...rest,
      customer_id: newCustomerId,
      address_id: newAddressId || null,
    };

    const { data, error } = await newDb
      .from('orders')
      .insert(newOrder)
      .select('id')
      .single();

    if (!error && data) {
      idMappings.orders[order.id] = data.id;
      imported++;
    }
  }

  console.log(`    ✅ Imported: ${imported}, Mapped: ${Object.keys(idMappings.orders).length}`);
  return { imported };
}

// STEP 6: Migrate order-related tables
async function migrateOrderRelated(tableName, remapFields = {}) {
  console.log(`\n📦 ${tableName}`);

  const { data } = await getTableData(tableName);
  if (!data || data.length === 0) {
    console.log('    ⏭️  No data');
    return { imported: 0 };
  }

  console.log(`    📤 Found ${data.length} in old DB`);

  const { data: existingIds } = await newDb.from(tableName).select('id');
  const existing = new Set((existingIds || []).map(r => r.id));

  let imported = 0;

  for (const record of data) {
    if (existing.has(record.id)) continue;

    // Remap foreign keys
    const newRecord = { ...record };
    for (const [field, mapping] of Object.entries(remapFields)) {
      if (record[field] && idMappings[mapping][record[field]]) {
        newRecord[field] = idMappings[mapping][record[field]];
      } else if (record[field]) {
        continue; // Skip if FK doesn't exist
      }
    }

    const { error } = await newDb.from(tableName).insert(newRecord);
    if (!error) imported++;
  }

  console.log(`    ✅ Imported: ${imported}`);
  return { imported };
}

async function verify() {
  console.log('\n\n🔍 VERIFICATION\n');

  const tables = [
    'customers', 'addresses', 'units', 'unit_media',
    'orders', 'payments', 'messages', 'route_stops'
  ];

  for (const table of tables) {
    const oldCount = await getCount(oldDb, table);
    const newCount = await getCount(newDb, table);
    const status = newCount >= oldCount ? '✅' : '⚠️';
    console.log(`  ${status} ${table.padEnd(20)} ${oldCount} → ${newCount}`);
  }
}

async function main() {
  try {
    console.log('🎯 Comprehensive migration with ID remapping\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Migrate in correct order
    await migrateCustomers();
    await migrateUnits();
    await migrateAddresses();
    await migrateUnitMedia();
    await migrateOrders();

    // Migrate order-related tables
    await migrateOrderRelated('payments', { order_id: 'orders' });
    await migrateOrderRelated('messages', { order_id: 'orders' });
    await migrateOrderRelated('route_stops', { order_id: 'orders' });
    await migrateOrderRelated('documents', { order_id: 'orders', customer_id: 'customers' });

    await verify();

    console.log('\n═'.repeat(60));
    console.log('✅ MIGRATION COMPLETE!');
    console.log('═'.repeat(60));
    console.log('\n📋 Next: Test your application\n');

  } catch (err) {
    console.error('\n❌ MIGRATION FAILED:\n', err);
    process.exit(1);
  }
}

main();
