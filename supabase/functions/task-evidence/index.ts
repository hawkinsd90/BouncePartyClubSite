import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { resolveCaller, callerHasAnyRole } from "../_shared/auth.ts";
import {
  EVIDENCE_BUCKET,
  EVIDENCE_COLUMNS,
  EVIDENCE_KINDS,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MAX_FILES_PER_REQUEST,
  EVIDENCE_MIME_EXTENSIONS,
  isTaskEvidencePath,
  newEvidencePath,
  resolveEvidenceUrls,
} from "../_shared/evidence-media.ts";
import type { EvidenceKind } from "../_shared/evidence-media.ts";

// Delivery / pickup / damage proof photos (task_status.delivery_images / damage_images).
//
// The proof photos are PRIVATE. Staff never write to Storage with a generic upload and never receive a stored public URL:
//   request_upload  the server derives the order from the task, picks the bucket, the folder
//                   "<order id>/<task status id>/<delivery|damage>/" and a random file name, and returns a signed upload
//                   authorization for exactly that object;
//   register        after the browser uploaded, the server checks the objects really exist in that task folder, appends the
//                   bare object paths to the task's column (existing entries, including historical URLs, stay first) and
//                   removes anything it was asked to register but could not;
//   discard         removes uploaded-but-unregistered objects of that task (the browser's cleanup after a failed batch);
//   view            returns short-lived signed viewing URLs for the evidence references of the given tasks, read from the
//                   database (never from what the browser sends).
// Callers: the signed-in Admin / Master / Crew session of the task screens, or the backend. Customers and anonymous
// callers get one uniform 403. The caller is checked before anything is read, signed or written.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
const denied = () => json({ success: false, error: "access_required" }, 403);
const badRequest = () => json({ success: false, error: "invalid_request" }, 400);

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_VIEW_TASKS = 200;
const OBJECT_FILE_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;
// What the browser needs back about a stored reference: where it points and a signed viewing URL, never the stored value.
const publicView = ({ bucket, path, legacy, url }: { bucket: string | null; path: string | null; legacy: boolean; url: string | null }) => ({ bucket, path, legacy, url });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return denied();

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return denied();
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const db: Db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Authorization first: nothing below runs for anyone but staff or the backend.
    const caller = await resolveCaller(db, req.headers.get("Authorization"), serviceKey);
    if (!(caller.kind === "service" || callerHasAnyRole(caller, ["admin", "master", "crew"]))) return denied();
    if (!isObj(body) || typeof body.action !== "string") return badRequest();

    switch (body.action) {
      case "request_upload": {
        const task = await readTarget(db, body, ["action", "taskStatusId", "kind", "files"]);
        if (task === "bad") return badRequest();
        if (!task) return json({ success: false, error: "not_found" }, 404);
        const files = body.files;
        if (!Array.isArray(files) || files.length < 1 || files.length > EVIDENCE_MAX_FILES_PER_REQUEST) return badRequest();
        for (const f of files) {
          if (!isObj(f) || !onlyKeys(f, ["name", "size", "mimeType"])) return badRequest();
          if (typeof f.name !== "string" || f.name.trim().length < 1 || f.name.length > 255) return badRequest();
          if (typeof f.size !== "number" || !Number.isInteger(f.size) || f.size < 1 || f.size > EVIDENCE_MAX_BYTES) return badRequest();
          if (typeof f.mimeType !== "string" || !(f.mimeType in EVIDENCE_MIME_EXTENSIONS)) return badRequest();
        }
        const uploads: { name: string; path: string; token: string }[] = [];
        for (const f of files as { name: string; mimeType: string }[]) {
          const path = newEvidencePath(task.orderId, task.id, task.kind, crypto.randomUUID(), f.mimeType);
          if (!path) return badRequest();
          const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
          if (error || !data?.token) {
            await discardUnregistered(db, task, uploads.map((u) => u.path));
            return json({ success: false, error: "upload_unavailable" }, 500);
          }
          uploads.push({ name: f.name, path, token: data.token });
        }
        return json({ success: true, bucket: EVIDENCE_BUCKET, uploads });
      }

      case "register": {
        const task = await readTarget(db, body, ["action", "taskStatusId", "kind", "paths"]);
        if (task === "bad") return badRequest();
        if (!task) return json({ success: false, error: "not_found" }, 404);
        const paths = readPaths(body.paths, task);
        if (!paths) return badRequest();

        const current = Array.isArray(task.current) ? (task.current as unknown[]) : [];
        if (new Set(paths).size !== paths.length || paths.some((p) => current.includes(p))) {
          return json({ success: false, error: "already_registered" }, 409);
        }
        const { data: listed } = await db.storage.from(EVIDENCE_BUCKET).list(`${task.orderId}/${task.id}/${task.kind}`, { limit: 1000 });
        const present = new Set(((listed as { name: string }[] | null) ?? []).map((o) => `${task.orderId}/${task.id}/${task.kind}/${o.name}`));
        if (!paths.every((p) => present.has(p))) {
          await discardUnregistered(db, task, paths);
          return json({ success: false, error: "upload_missing" }, 409);
        }
        const { error } = await db.from("task_status").update({ [EVIDENCE_COLUMNS[task.kind]]: [...current, ...paths] }).eq("id", task.id);
        if (error) {
          await discardUnregistered(db, task, paths);
          return json({ success: false, error: "save_failed" }, 500);
        }
        return json({ success: true });
      }

      case "discard": {
        const task = await readTarget(db, body, ["action", "taskStatusId", "kind", "paths"]);
        if (task === "bad") return badRequest();
        if (!task) return json({ success: false, error: "not_found" }, 404);
        const paths = readPaths(body.paths, task);
        if (!paths) return badRequest();
        await discardUnregistered(db, task, paths);
        return json({ success: true });
      }

      case "view": {
        if (!onlyKeys(body, ["action", "taskStatusIds"])) return badRequest();
        const ids = body.taskStatusIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_VIEW_TASKS || !ids.every((i) => typeof i === "string" && TASK_ID_RE.test(i))) return badRequest();
        const { data: rows } = await db.from("task_status").select("id, order_id, delivery_images, damage_images").in("id", ids);
        const tasks: Record<string, unknown> = {};
        for (const row of (rows as { id: string; order_id: string; delivery_images: unknown; damage_images: unknown }[] | null) ?? []) {
          const entry: Record<string, unknown> = {};
          for (const kind of EVIDENCE_KINDS) {
            entry[kind] = (await resolveEvidenceUrls(db, row[EVIDENCE_COLUMNS[kind]], { orderId: row.order_id, taskStatusId: row.id, kind })).map(publicView);
          }
          tasks[row.id] = entry;
        }
        return json({ success: true, tasks });
      }
    }
    return badRequest();
  } catch {
    console.error("[task-evidence] failed");
    return json({ success: false, error: "unavailable" }, 500);
  }
});

interface Target {
  id: string;
  orderId: string;
  kind: EvidenceKind;
  // the current value of the task's column for this kind
  current: unknown;
}

// Validates the request's task and kind and loads the task. "bad" = malformed request, null = no such task.
async function readTarget(db: Db, body: Record<string, unknown>, allowedKeys: string[]): Promise<Target | "bad" | null> {
  if (!onlyKeys(body, allowedKeys)) return "bad";
  if (typeof body.taskStatusId !== "string" || !TASK_ID_RE.test(body.taskStatusId)) return "bad";
  if (typeof body.kind !== "string" || !EVIDENCE_KINDS.includes(body.kind as EvidenceKind)) return "bad";
  const kind = body.kind as EvidenceKind;
  const { data: row } = await db.from("task_status").select("id, order_id, delivery_images, damage_images").eq("id", body.taskStatusId).maybeSingle();
  if (!row?.order_id) return null;
  return { id: row.id, orderId: row.order_id, kind, current: row[EVIDENCE_COLUMNS[kind]] };
}

// The paths of a register / discard request: server-issued objects of THIS task and kind, nothing else.
function readPaths(raw: unknown, task: Target): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > EVIDENCE_MAX_FILES_PER_REQUEST) return null;
  if (!raw.every((p) => isTaskEvidencePath(p, task.orderId, task.id, task.kind) && OBJECT_FILE_RE.test(p))) return null;
  return raw as string[];
}

// Removes objects the server issued for this task that the task does not reference. Failure to remove is not an error for the
// caller: the object stays private either way.
async function discardUnregistered(db: Db, task: Target, paths: string[]): Promise<void> {
  try {
    const { data: row } = await db.from("task_status").select(EVIDENCE_COLUMNS[task.kind]).eq("id", task.id).maybeSingle();
    const registered = new Set(Array.isArray(row?.[EVIDENCE_COLUMNS[task.kind]]) ? (row[EVIDENCE_COLUMNS[task.kind]] as unknown[]) : []);
    const doomed = paths.filter((p) => !registered.has(p) && isTaskEvidencePath(p, task.orderId, task.id, task.kind));
    if (doomed.length > 0) await db.storage.from(EVIDENCE_BUCKET).remove(doomed);
  } catch {
    console.error("[task-evidence] cleanup failed");
  }
}
