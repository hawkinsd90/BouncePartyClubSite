import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const migrationsDir = './supabase/migrations';
const outputFile = './apply-all-migrations.sql';

console.log('📋 Consolidating all migrations...\n');

const files = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Found ${files.length} migration files\n`);

let output = `-- =====================================================
-- COMPLETE DATABASE MIGRATION SCRIPT
-- Apply this entire script in the SQL Editor of your NEW Supabase project
-- =====================================================

-- This script combines all ${files.length} migration files in the correct order
-- Each migration is separated by comments for clarity

`;

for (const file of files) {
  console.log(`  ▶ ${file}`);
  const content = readFileSync(join(migrationsDir, file), 'utf-8');

  output += `\n-- =====================================================\n`;
  output += `-- MIGRATION: ${file}\n`;
  output += `-- =====================================================\n\n`;
  output += content;
  output += `\n\n`;
}

writeFileSync(outputFile, output);

console.log(`\n✅ Consolidated SQL written to: ${outputFile}`);
console.log(`📝 File size: ${(output.length / 1024).toFixed(2)} KB\n`);
