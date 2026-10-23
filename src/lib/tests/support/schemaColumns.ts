// Column lists taken from the replayed database schema (information_schema.columns of bpc_replay_full), for fake database clients in handler
// tests: a fake that accepts any column name lets a function write a column that does not exist (it would fail with 42703 for real).
// twilioStatusCallback.test.ts compares these lists with the live catalog whenever a scratch database is reachable, so they cannot rot.
export const SMS_CONVERSATIONS_COLUMNS = [
  'id', 'order_id', 'from_phone', 'to_phone', 'message_body', 'direction', 'twilio_message_sid', 'status', 'created_at', 'is_admin_internal',
] as const;

export const SCHEMA_COLUMNS: Record<string, readonly string[]> = {
  sms_conversations: SMS_CONVERSATIONS_COLUMNS,
};

// The column names a write (insert/update/upsert payload, one object or an array of objects) names that the table does not have.
export function unknownColumns(table: string, payload: unknown): string[] {
  const known = SCHEMA_COLUMNS[table];
  if (!known || payload === null || typeof payload !== 'object') return [];
  const rows = Array.isArray(payload) ? payload : [payload];
  const bad = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row as Record<string, unknown>)) if (!known.includes(k)) bad.add(k);
  return [...bad];
}
