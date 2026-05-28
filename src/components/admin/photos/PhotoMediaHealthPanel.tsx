import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, ShieldAlert, Video, Layers, AlertTriangle } from 'lucide-react';
import type { AdminPhoto } from '../../../hooks/useAdminPhotos';

interface PhotoMediaHealthPanelProps {
  allPhotos: AdminPhoto[];
}

interface HealthNote {
  icon: React.ReactNode;
  title: string;
  detail: string;
  level: 'info' | 'warn';
}

export function PhotoMediaHealthPanel({ allPhotos }: PhotoMediaHealthPanelProps) {
  const [open, setOpen] = useState(false);

  const damageCount = allPhotos.filter(p => p.source === 'damage').length;
  const unitNoPath = allPhotos.filter(p => p.source === 'unit' && !p.file_path).length;

  const notes: HealthNote[] = [
    {
      icon: <ShieldAlert className="w-4 h-4 text-amber-500" />,
      title: 'Evidence photos are read-only',
      detail: 'Delivery and damage photos are marked as protected evidence. They cannot be deleted from this library. Promotion is allowed with an explicit confirmation step.',
      level: 'info',
    },
    {
      icon: <Video className="w-4 h-4 text-slate-500" />,
      title: 'Carousel videos are not shown',
      detail: 'Carousel entries with media_type = "video" are excluded from this library because it is photo-only. Videos remain active in the hero carousel on the public site.',
      level: 'info',
    },
    {
      icon: <Layers className="w-4 h-4 text-sky-500" />,
      title: 'Unit images may lack a storage path',
      detail: `${unitNoPath} unit image${unitNoPath !== 1 ? 's' : ''} ${unitNoPath !== 1 ? 'have' : 'has'} no storage path recorded. These reference an external or legacy URL directly. Deletion from the unit inventory will not clean up storage for these items.`,
      level: unitNoPath > 0 ? 'warn' : 'info',
    },
  ];

  if (damageCount > 0) {
    notes.push({
      icon: <AlertTriangle className="w-4 h-4 text-red-500" />,
      title: `${damageCount} damage photo${damageCount !== 1 ? 's' : ''} present`,
      detail: 'Damage photos are marketing-restricted and cannot be promoted to unit galleries or the carousel. They are retained as evidence only.',
      level: 'warn',
    });
  }

  const warningCount = notes.filter(n => n.level === 'warn').length;
  const hasWarnings = warningCount > 0;

  return (
    <div className={`rounded-xl border mb-5 overflow-hidden ${hasWarnings ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <Info className={`w-4 h-4 flex-shrink-0 ${hasWarnings ? 'text-amber-600' : 'text-slate-500'}`} />
        <span className={`text-sm font-semibold flex-1 ${hasWarnings ? 'text-amber-800' : 'text-slate-700'}`}>
          Media Health Notes
          {hasWarnings && (
            <span className="ml-2 text-xs font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-200/60">
          {notes.map((note, i) => (
            <div
              key={i}
              className={`flex gap-3 p-3 rounded-lg border ${
                note.level === 'warn' ? 'bg-amber-100/80 border-amber-200' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">{note.icon}</div>
              <div>
                <p className={`text-sm font-semibold mb-0.5 ${note.level === 'warn' ? 'text-amber-900' : 'text-slate-800'}`}>
                  {note.title}
                </p>
                <p className={`text-xs leading-relaxed ${note.level === 'warn' ? 'text-amber-800' : 'text-slate-600'}`}>
                  {note.detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
