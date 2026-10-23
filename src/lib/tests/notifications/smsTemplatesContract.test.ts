// Admin SMS Templates: the screens must use the real column. public.sms_message_templates has message_template (NOT message_body, which is a column of
// sms_conversations). Before the fix both screens selected '*' but read/wrote message_body: the text rendered blank and a save was refused (42703).
// The database-side proof (original query fails, corrected query loads/updates/reloads, other columns unchanged, non-admins refused) runs against a real
// PostgreSQL in coreDatabaseAccess (block 'sms_message_templates'). This file covers the UI contract and the senders without a database or any SMS.
// PASS - LOCAL AUTOMATED.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SMS_TEMPLATE_SELECT, smsTemplateUpdate } from '../../notifications/smsTemplates';

declare const require: (id: string) => any;

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- the shared contract ---
ok('the select lists the real columns and no message_body', SMS_TEMPLATE_SELECT.split(/,\s*/).join(',') === 'id,template_key,template_name,message_template,description');
ok('the update writes only message_template', JSON.stringify(smsTemplateUpdate('Hi {customer_first_name}')) === '{"message_template":"Hi {customer_first_name}"}');

// --- the screens ---
const tab = read('src/components/admin/settings/MessageTemplatesTab.tsx');
const admin = read('src/components/admin/settings/AdminSMSTemplates.tsx');
for (const [name, text] of [['MessageTemplatesTab', tab], ['AdminSMSTemplates', admin]] as const) {
  ok(`${name} no longer references message_body`, !/message_body/.test(text));
  ok(`${name} saves through smsTemplateUpdate (message_template)`, /\.update\(smsTemplateUpdate\(/.test(text) && /message_template/.test(text));
}
ok('MessageTemplatesTab loads with the shared select', /from\('sms_message_templates'\)\.select\(SMS_TEMPLATE_SELECT\)/.test(tab));

// AdminSMSTemplates renders from props (no effects), so it can be rendered: the saved text must appear.
function loadTsx(file: string, stubs: Record<string, any> = {}): any {
  const path = require('path');
  const ts = require('typescript');
  const abs = path.resolve(file);
  const out = ts.transpileModule(readFileSync(abs, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText.split('import.meta.env').join('({})');
  const mod: any = { exports: {} };
  const req = (id: string) => {
    if (id in stubs) return stubs[id];
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(abs), id);
    return require('fs').existsSync(base + '.tsx') ? loadTsx(base + '.tsx', stubs) : require(base);
  };
  new Function('require', 'module', 'exports', out)(req, mod, mod.exports);
  return mod.exports;
}
const stubs = {
  '../../../lib/supabase': { supabase: {} },
  '../../../lib/toasts': { notifyError() {}, notifySuccess() {} },
};
const { AdminSMSTemplates } = loadTsx('src/components/admin/settings/AdminSMSTemplates.tsx', stubs);
const rows = [
  { id: '1', template_key: 'order_rejected', template_name: 'Order Rejected', description: 'Sent when a booking is rejected', message_template: 'Hi {customer_first_name}, sorry: {rejection_reason}' },
  { id: '2', template_key: 'eta_sms', template_name: 'ETA', description: null, message_template: 'We arrive in {eta_time}' },
];
const html = renderToStaticMarkup(createElement(AdminSMSTemplates, { templates: rows, onRefetch() {} }));
ok('the saved template text is shown (not blank)', html.includes('Hi {customer_first_name}, sorry: {rejection_reason}') && html.includes('We arrive in {eta_time}'));
ok('names are shown too', html.includes('Order Rejected') && html.includes('ETA'));

// --- the senders read message_template, and no active code reads message_body from the templates table ---
for (const f of ['supabase/functions/send-sms-notification/index.ts', 'supabase/functions/customer-cancel-order/index.ts']) {
  const t = read(f);
  ok(`${f} reads message_template from sms_message_templates`, /from\("sms_message_templates"\)\s*\.select\("message_template"\)/.test(t.replace(/\s+/g, ' ').replace(/\) \./g, ').')) || /sms_message_templates"\)\s*\.select\("message_template"\)/.test(t));
}
const offenders: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) { if (e !== 'tests' && e !== 'node_modules') walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(e) || /\.test\.ts$/.test(e)) continue;
    const lines = read(p).split('\n');
    lines.forEach((l, i) => {
      if (!/sms_message_templates/.test(l)) return;
      if (lines.slice(Math.max(0, i - 2), i + 8).some((x) => /message_body/.test(x))) offenders.push(`${p}:${i + 1}`);
    });
  }
}
walk('src');
walk('supabase/functions');
ok(`no active code reads or writes message_body next to sms_message_templates${offenders.length ? ' (' + offenders.join(', ') + ')' : ''}`, offenders.length === 0);
const types = read('src/lib/database.types.ts');
const tpl = types.slice(types.indexOf('sms_message_templates: {'), types.indexOf('tasks: {'));
ok('database.types: sms_message_templates has message_template and no message_body / is_active', /message_template: string/.test(tpl) && !/message_body|is_active/.test(tpl));

console.log(`smsTemplatesContract: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} sms template contract test(s) failed`);
