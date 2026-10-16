// Turns two introspected schemas into a refresh PLAN, or into reasons the refresh must not run. Pure: no database access.
//
// Principle: stop before anything is changed. Anything this module does not understand is a blocker, not a guess.

import {
  CLEARED_WITH_ORDERS,
  CUSTOMER_OWNER_COLUMN,
  CUSTOMER_OWNER_TABLE,
  DEFERRED_COLUMNS,
  FORCED_VALUES,
  QUARANTINED_STRIPE_COLUMNS,
  RESTORE_CONDITIONS,
  REVIEWED_TRIGGERS,
  REPLACE_TABLES,
} from './config.mjs';

const baseType = (t) => String(t).replace(/\(.*?\)/g, '').trim();

export function analyze(prod, dev, opts = {}) {
  const scope = opts.scope || REPLACE_TABLES;
  const deferredCfg = opts.deferred || DEFERRED_COLUMNS;
  const cleared = opts.cleared || CLEARED_WITH_ORDERS;
  const reviewed = opts.reviewedTriggers || REVIEWED_TRIGGERS;
  const acknowledged = new Set(opts.acknowledgeTriggers || []);
  const blockers = [];
  const warnings = [];
  const block = (m) => blockers.push(m);
  const warn = (m) => warnings.push(m);
  const inScope = new Set(scope);

  if (!prod.hasAuthUsers) warn('Production auth.users is not readable; nothing is needed from it.');
  if (!dev.hasAuthUsers) block('Development has no auth.users table; ownership mapping cannot be verified.');
  if (!prod.role.bypassRls) block(`The Production connection role "${prod.role.name}" does not bypass row-level security, so the export could silently be incomplete.`);
  if (!dev.role.bypassRls) block(`The Development connection role "${dev.role.name}" does not bypass row-level security, so the replacement could silently be partial.`);

  const tables = [];
  for (const name of scope) {
    const d = dev.tables[name];
    const p = prod.tables[name];
    if (!d && !p) {
      warn(`${name}: exists in neither database; skipped.`);
      continue;
    }
    if (!d) {
      tables.push({ name, mode: 'skip', copied: [], prodOnly: (p.columns || []).map((c) => c.name) });
      warn(`${name}: exists in Production but not in Development, so its Production rows cannot be loaded (Development schema is behind or differs).`);
      continue;
    }
    if (!d.pk.length) block(`${name}: Development table has no primary key; rows cannot be matched for verification.`);
    if (!p) {
      tables.push({ name, mode: 'delete-only', copied: [], pk: d.pk, serials: d.serials, devColumns: d.columns.filter((c) => !c.generated).map((c) => c.name) });
      warn(`${name}: exists in Development but not in Production; its Development rows are deleted and nothing is loaded.`);
      continue;
    }

    const prodCols = new Map(p.columns.map((c) => [c.name, c]));
    const devCols = new Map(d.columns.map((c) => [c.name, c]));
    const copied = [];
    const coalesced = [];
    const nonNullChecked = [];
    const devOnly = [];
    let overridingSystem = false;
    for (const dc of d.columns) {
      if (dc.generated) continue;
      const pc = prodCols.get(dc.name);
      if (!pc) {
        if (dc.notNull && dc.default == null && dc.identity === '') block(`${name}.${dc.name}: required (NOT NULL, no default) in Development but absent in Production; cannot be filled.`);
        else devOnly.push(dc.name);
        continue;
      }
      if (baseType(pc.type) !== baseType(dc.type)) {
        block(`${name}.${dc.name}: type differs (Production ${pc.type}, Development ${dc.type}).`);
        continue;
      }
      if (pc.type !== dc.type) warn(`${name}.${dc.name}: type modifier differs (Production ${pc.type}, Development ${dc.type}); the rehearsal will show whether the data fits.`);
      copied.push(dc.name);
      if (dc.identity === 'a') overridingSystem = true;
      if (dc.notNull && !pc.notNull) {
        if (dc.default != null) coalesced.push({ column: dc.name, default: dc.default });
        else nonNullChecked.push(dc.name);
      }
    }
    const prodOnly = p.columns.filter((c) => !devCols.has(c.name)).map((c) => c.name);
    for (const k of d.pk) if (!copied.includes(k)) block(`${name}.${k}: primary key column is not available from Production; rows would receive new ids.`);

    const deferred = (deferredCfg[name] || []).filter((c) => copied.includes(c));
    const quarantined = (QUARANTINED_STRIPE_COLUMNS[name] || []).filter((c) => copied.includes(c));
    const forced = Object.entries(FORCED_VALUES[name] || {})
      .filter(([c]) => copied.includes(c))
      .map(([column, v]) => ({ column, sql: v.sql, reason: v.reason }));
    const authRefs = [];
    let ownerColumn = null;
    for (const fk of dev.fks) {
      if (fk.childSchema !== 'public' || fk.childTable !== name) continue;
      if (fk.parentSchema === 'auth' && fk.parentTable === 'users') {
        if (fk.childColumns.length !== 1) {
          block(`${name}.${fk.name}: composite reference to auth.users is not supported.`);
          continue;
        }
        const col = fk.childColumns[0];
        if (!copied.includes(col)) continue;
        if (name === CUSTOMER_OWNER_TABLE && col === CUSTOMER_OWNER_COLUMN) ownerColumn = col;
        else authRefs.push(col);
      }
    }
    // An ownership column without a foreign key would be copied raw; make sure the known one is always treated as ownership.
    if (name === CUSTOMER_OWNER_TABLE && copied.includes(CUSTOMER_OWNER_COLUMN) && !ownerColumn) ownerColumn = CUSTOMER_OWNER_COLUMN;

    const transformed = new Set([...quarantined, ...forced.map((f) => f.column), ...authRefs, ...coalesced.map((x) => x.column), ...(ownerColumn ? [ownerColumn] : [])]);
    tables.push({
      name,
      mode: 'import',
      copied,
      devOnly,
      prodOnly,
      coalesced,
      nonNullChecked,
      deferred,
      quarantined,
      forced,
      authRefs,
      ownerColumn,
      transformed: [...transformed],
      compared: copied.filter((c) => !transformed.has(c)),
      overridingSystem,
      devColumns: d.columns.filter((c) => !c.generated).map((c) => c.name),
      pk: d.pk,
      serials: d.serials,
    });
  }

  const order = new Map(scope.map((n, i) => [n, i]));
  const byName = new Map(tables.map((t) => [t.name, t]));

  // ---- foreign keys ------------------------------------------------------------------------------------------------
  const intraFks = [];
  const externalFks = [];
  const preservedChildren = [];
  const clearedWithOrders = [];
  const deletable = (n) => byName.has(n);
  for (const fk of dev.fks) {
    const childScoped = fk.childSchema === 'public' && inScope.has(fk.childTable) && deletable(fk.childTable);
    const parentScoped = fk.parentSchema === 'public' && inScope.has(fk.parentTable) && deletable(fk.parentTable);

    if (childScoped && byName.get(fk.childTable).mode === 'import') {
      if (fk.parentSchema === 'auth' && fk.parentTable === 'users') continue; // ownership / attribution mapping
      if (fk.parentSchema !== 'public') {
        block(`${fk.childTable}.${fk.name}: references ${fk.parentSchema}.${fk.parentTable}; only auth.users and public tables are supported.`);
        continue;
      }
      if (fk.childColumns.length !== 1) {
        block(`${fk.childTable}.${fk.name}: composite foreign keys are not supported.`);
        continue;
      }
      const childT = byName.get(fk.childTable);
      const col = fk.childColumns[0];
      if (!childT.copied.includes(col)) continue;
      if (parentScoped) {
        const forward = order.get(fk.parentTable) > order.get(fk.childTable) || fk.parentTable === fk.childTable;
        if (forward && !childT.deferred.includes(col)) {
          block(`${fk.childTable}.${col} -> ${fk.parentTable}: the parent is loaded after the child (or is the same table) and the column is not declared deferred. Reorder or defer it in config.mjs.`);
        }
        intraFks.push({ name: fk.name, child: fk.childTable, childColumn: col, parent: fk.parentTable, parentColumn: fk.parentColumns[0], deferred: childT.deferred.includes(col) });
      } else {
        externalFks.push({ name: fk.name, child: fk.childTable, childColumn: col, parent: fk.parentTable, parentColumn: fk.parentColumns[0] });
      }
    }

    if (!childScoped && parentScoped) {
      if (fk.childSchema !== 'public') {
        block(`${fk.childSchema}.${fk.childTable}.${fk.name}: an object outside public references a replaced table.`);
        continue;
      }
      if (cleared.includes(fk.childTable)) {
        if (fk.onDelete !== 'c') block(`${fk.childTable}.${fk.name}: expected ON DELETE CASCADE for a table cleared with its orders (found ${fk.onDelete}).`);
        else clearedWithOrders.push({ table: fk.childTable, via: fk.name, parent: fk.parentTable, pk: dev.tables[fk.childTable].pk, columns: dev.tables[fk.childTable].columns.filter((c) => !c.generated).map((c) => c.name) });
        continue;
      }
      if (fk.onDelete === 'n') {
        const childT = dev.tables[fk.childTable];
        if (!childT || !childT.pk.length) {
          block(`${fk.childTable}.${fk.name}: references ${fk.parentTable} with SET NULL but has no primary key to remember rows by.`);
          continue;
        }
        if (fk.childColumns.length !== 1) {
          block(`${fk.childTable}.${fk.name}: composite SET NULL reference is not supported.`);
          continue;
        }
        const key = `${fk.childTable}.${fk.childColumns[0]}`;
        preservedChildren.push({
          name: fk.name,
          table: fk.childTable,
          pk: childT.pk,
          column: fk.childColumns[0],
          parent: fk.parentTable,
          parentColumn: fk.parentColumns[0],
          condition: RESTORE_CONDITIONS[key] || null,
        });
      } else if (fk.onDelete === 'c') {
        block(`${fk.childTable}.${fk.name}: ON DELETE CASCADE from ${fk.parentTable} would delete rows of an unscoped table. Add it to the replace scope or to CLEARED_WITH_ORDERS after review.`);
      } else {
        block(`${fk.childTable}.${fk.name}: an unscoped table references ${fk.parentTable} without ON DELETE SET NULL/CASCADE; deleting ${fk.parentTable} rows would fail.`);
      }
    }
  }
  for (const c of cleared) {
    if (dev.tables[c] && !clearedWithOrders.some((x) => x.table === c)) warn(`${c}: listed as cleared with orders but no foreign key from it to a replaced table was found.`);
  }

  // ---- triggers ----------------------------------------------------------------------------------------------------
  const suppressedTables = new Set([...tables.map((t) => t.name), ...clearedWithOrders.map((c) => c.table), ...preservedChildren.map((p) => p.table)]);
  const triggers = [];
  for (const t of dev.triggers) {
    if (!suppressedTables.has(t.table)) {
      if (t.callsOutside) warn(`Trigger ${t.table}.${t.name} (${t.function}) appears to call an external service; it is not on a table this refresh touches.`);
      continue;
    }
    const key = `${t.table}.${t.name}`;
    const onReplaced = inScope.has(t.table) || cleared.includes(t.table);
    const isReviewed = Object.prototype.hasOwnProperty.call(reviewed, key) || acknowledged.has(key);
    if (onReplaced && !isReviewed) block(`Trigger ${key} (${t.function}) on a replaced table has not been reviewed. Review it, add it to REVIEWED_TRIGGERS in config.mjs (or pass --acknowledge-trigger ${key}).`);
    if (t.callsOutside) warn(`Trigger ${key} (${t.function}) appears to call an external service; it is switched off during the refresh.`);
    triggers.push({ table: t.table, name: t.name, enabled: t.enabled, function: t.function, reviewed: isReviewed, reason: reviewed[key] || (acknowledged.has(key) ? 'acknowledged on the command line' : null) });
  }

  return {
    tables,
    intraFks,
    externalFks,
    preservedChildren,
    clearedWithOrders,
    triggers,
    blockers,
    warnings,
    ok: blockers.length === 0,
  };
}

export function importTables(plan) {
  return plan.tables.filter((t) => t.mode === 'import');
}
export function deleteTables(plan) {
  return plan.tables.filter((t) => t.mode === 'import' || t.mode === 'delete-only');
}
