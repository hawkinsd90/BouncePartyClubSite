import { useEffect, useState } from 'react';
import { fetchTaskEvidenceViews } from '../../lib/tasks/taskEvidenceApi';

export interface TaskEvidenceUrls {
  // One entry per stored reference, in stored order; null while loading or when the reference cannot be shown.
  delivery: Array<string | null>;
  damage: Array<string | null>;
}

// Signed viewing URLs for one task's evidence photos. Re-fetched when the task or its stored references change (for example
// after an upload), never cached beyond the screen.
export function useTaskEvidenceUrls(taskStatusId: string | undefined, deliveryRefs: string[] | undefined, damageRefs: string[] | undefined): TaskEvidenceUrls {
  const delivery = deliveryRefs ?? [];
  const damage = damageRefs ?? [];
  const key = `${taskStatusId ?? ''}|${delivery.join(',')}|${damage.join(',')}`;
  const [urls, setUrls] = useState<{ key: string; value: TaskEvidenceUrls } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!taskStatusId || (delivery.length === 0 && damage.length === 0)) return;
    fetchTaskEvidenceViews([taskStatusId]).then((views) => {
      if (cancelled) return;
      const entry = views[taskStatusId];
      setUrls({
        key,
        value: {
          delivery: delivery.map((_, i) => entry?.delivery?.[i]?.url ?? null),
          damage: damage.map((_, i) => entry?.damage?.[i]?.url ?? null),
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (urls && urls.key === key) return urls.value;
  return { delivery: delivery.map(() => null), damage: damage.map(() => null) };
}
