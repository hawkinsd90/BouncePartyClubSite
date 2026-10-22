import { useRef, useState } from 'react';
import { Copy, MessageSquare, Phone } from 'lucide-react';
import { formatPhoneDisplay, isUsablePhone, smsHref, telHref } from '../../lib/core/phone';
import { useDismissable } from '../../hooks/core/useBodyScrollLock';
import { showToast } from '../../lib/toasts';

interface Props {
  phone: string | null | undefined;
  className?: string;
  // Shown when there is no usable number. Never the word "No phone" inside a link.
  emptyLabel?: string;
  // Hide the Message option (for a number that must not be texted).
  allowMessage?: boolean;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Phone number copied', 'success');
  } catch {
    showToast('Could not copy the number. Select it and copy manually.', 'error');
  }
}

// A phone number as a tap target: tapping opens a small menu (a bottom sheet on a phone) with Copy (national format, friendly to Google Voice),
// Call and Message. A value that is not a real number renders as plain text and no links.
export function PhoneLink({ phone, className = '', emptyLabel = 'No phone on file', allowMessage = true }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useDismissable(ref, open, () => setOpen(false));

  if (!isUsablePhone(phone)) {
    return <span className={`text-slate-500 ${className}`}>{emptyLabel}</span>;
  }
  const display = formatPhoneDisplay(phone);
  const item = 'flex items-center gap-3 w-full px-4 py-3 text-left text-slate-800 hover:bg-blue-50 font-medium min-h-[48px]';

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-haspopup="true"
        className={`text-blue-700 hover:underline min-h-[32px] ${className}`}
      >
        {display}
      </button>
      {open && (
        <div
          role="menu"
          className="fixed inset-x-0 bottom-0 z-[70] bg-white border-t border-slate-200 shadow-2xl rounded-t-xl pb-2 sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-lg sm:border sm:pb-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 pt-3 pb-1 text-sm font-semibold text-slate-600 sm:hidden">{display}</div>
          <button type="button" role="menuitem" className={item} onClick={() => { void copyText(display); setOpen(false); }}>
            <Copy className="w-5 h-5 text-slate-500" /> Copy number
          </button>
          <a role="menuitem" className={item} href={telHref(phone) ?? undefined} onClick={() => setOpen(false)}>
            <Phone className="w-5 h-5 text-slate-500" /> Call
          </a>
          {allowMessage && (
            <a role="menuitem" className={item} href={smsHref(phone) ?? undefined} onClick={() => setOpen(false)}>
              <MessageSquare className="w-5 h-5 text-slate-500" /> Message
            </a>
          )}
          <button type="button" role="menuitem" className={`${item} sm:hidden border-t border-slate-100 text-slate-500`} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </span>
  );
}
