import { useEffect, useState } from 'react';
import { fetchTaskEvidenceViewsChecked } from '../../lib/tasks/taskEvidenceApi';

export interface TaskEvidenceUrls {
  // One entry per stored reference, in stored order; null while loading or when the reference cannot be shown.
  delivery: Array<string | null>;
  damage: Array<string | null>;
  // 'error': the lookup failed (offline, server); call retry(). Tiles with no URL after a good lookup are simply unavailable.
  status: 'idle' | 'loading' | 'ready' | 'error';
  retry: () => void;
}

// Signed viewing URLs for one task's evidence photos. Re-fetched when the task or its stored references change (for example
// after an upload), never cached beyond the screen.
export function useTaskEvidenceUrls(taskStatusId: string | undefined, deliveryRefs: string[] | undefined, damageRefs: string[] | undefined): TaskEvidenceUrls {
  const delivery = deliveryRefs ?? [];
  const damage = damageRefs ?? [];
  const [attempt, setAttempt] = useState(0);
  const key = `${taskStatusId ?? ''}|${delivery.join(',')}|${damage.join(',')}|${attempt}`;
  const [urls, setUrls] = useState<{ key: string; value: Omit<TaskEvidenceUrls, 'retry'> } | null>(null);
  const retry = () => setAttempt((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    if (!taskStatusId || (delivery.length === 0 && damage.length === 0)) return;
    fetchTaskEvidenceViewsChecked([taskStatusId]).then(({ views, failed }) => {
      if (cancelled) return;
      const entry = views[taskStatusId];
      setUrls({
        key,
        value: {
          delivery: delivery.map((_, i) => entry?.delivery?.[i]?.url ?? null),
          damage: damage.map((_, i) => entry?.damage?.[i]?.url ?? null),
          status: failed || !entry ? 'error' : 'ready',
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reloads when the evidence key (task + attempt) changes; the task list itself is read through the key
  }, [key]);

  if (urls && urls.key === key) return { ...urls.value, retry };
  const hasAny = taskStatusId && (delivery.length > 0 || damage.length > 0);
  return { delivery: delivery.map(() => null), damage: damage.map(() => null), status: hasAny ? 'loading' : 'idle', retry };
}
