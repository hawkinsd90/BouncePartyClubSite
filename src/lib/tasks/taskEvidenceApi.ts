// Browser client for viewing task evidence photos (delivery / pickup / damage proof).
//
// The photos are private. The browser never builds a Storage URL and never reads the stored references itself: it asks the
// task-evidence function (staff session) for short-lived signed viewing URLs for tasks, and the function reads the
// references from the database. Failures degrade to "no URL" so a screen shows a placeholder instead of breaking.

import { supabase } from '../supabase';

export interface EvidenceView {
  // one entry per reference stored on the task, in stored order (the stored value itself is never returned)
  bucket: string | null;
  path: string | null;
  legacy: boolean;
  // short-lived signed URL, or null when the reference is untrusted or could not be signed
  url: string | null;
}

export type TaskEvidenceViews = Record<string, { delivery: EvidenceView[]; damage: EvidenceView[] }>;

const CHUNK = 200;

// `failed` is true when any request could not be answered (offline, server error), so a screen can offer a retry instead of showing
// blank tiles forever.
export async function fetchTaskEvidenceViewsChecked(taskStatusIds: string[]): Promise<{ views: TaskEvidenceViews; failed: boolean }> {
  const ids = Array.from(new Set(taskStatusIds.filter(Boolean)));
  const out: TaskEvidenceViews = {};
  let failed = false;
  for (let i = 0; i < ids.length; i += CHUNK) {
    try {
      const { data, error } = await supabase.functions.invoke('task-evidence', {
        body: { action: 'view', taskStatusIds: ids.slice(i, i + CHUNK) },
      });
      if (!error && data?.success && data.tasks) Object.assign(out, data.tasks as TaskEvidenceViews);
      else failed = true;
    } catch {
      failed = true;
    }
  }
  return { views: out, failed };
}

export async function fetchTaskEvidenceViews(taskStatusIds: string[]): Promise<TaskEvidenceViews> {
  return (await fetchTaskEvidenceViewsChecked(taskStatusIds)).views;
}
