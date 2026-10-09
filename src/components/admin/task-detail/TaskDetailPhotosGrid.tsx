import { useTaskEvidenceUrls } from '../../../hooks/useTaskEvidenceUrls';

interface Props {
  // The task the photos belong to, and the references stored on it (private object paths, or historical URLs).
  taskStatusId?: string;
  deliveryImages?: string[];
  damageImages?: string[];
}

// Display only. The parent decides when to render this section (at least one image list is non-empty). The stored references are
// never used as image sources: the server returns short-lived signed URLs for them.
export function TaskDetailPhotosGrid({ taskStatusId, deliveryImages, damageImages }: Props) {
  const urls = useTaskEvidenceUrls(taskStatusId, deliveryImages, damageImages);
  const tile = (url: string | null, alt: string, border: string) =>
    url ? (
      <img src={url} alt={alt} className={`w-full h-24 object-cover rounded-lg border ${border}`} />
    ) : (
      <div className={`w-full h-24 rounded-lg border ${border} bg-slate-100`} aria-label={alt} />
    );
  return (
    <div className="border-t border-slate-200 pt-6">
      <h3 className="font-bold text-slate-900 mb-4">Photos</h3>
      {deliveryImages && deliveryImages.length > 0 && (
        <div className="mb-4">
          <h4 className="font-semibold text-sm text-slate-700 mb-2">Delivery Photos</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {deliveryImages.map((_ref, idx) => (
              <div key={idx}>{tile(urls.delivery[idx] ?? null, `Delivery ${idx + 1}`, 'border-slate-200')}</div>
            ))}
          </div>
        </div>
      )}
      {damageImages && damageImages.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-slate-700 mb-2">Damage Photos</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {damageImages.map((_ref, idx) => (
              <div key={idx}>{tile(urls.damage[idx] ?? null, `Damage ${idx + 1}`, 'border-red-200')}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
