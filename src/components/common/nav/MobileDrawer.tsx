import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LogIn, LogOut, Phone, X } from 'lucide-react';
import type { NavModel } from '../../../lib/core/navLinks';
import { nextFocusIndex } from '../../../lib/core/navLinks';
import { useBodyScrollLock } from '../../../hooks/core/useBodyScrollLock';

interface Props {
  open: boolean;
  model: NavModel;
  email?: string | null;
  businessPhone: string;
  addOnsExpanded: boolean;
  onToggleAddOns: () => void;
  onClose: () => void;
  onSignOut: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const rowClass = 'flex items-center w-full text-left text-slate-700 hover:text-blue-600 hover:bg-blue-50 font-medium py-3 px-3 rounded-lg transition-colors text-base min-h-[44px]';

// Phone menu: a right-hand drawer over a backdrop. It scrolls on its own, locks the page behind it, closes on a link, the backdrop, the
// X and Escape, moves focus in, keeps Tab inside, and gives focus back to the button that opened it.
export function MobileDrawer({ open, model, email, businessPhone, addOnsExpanded, onToggleAddOns, onClose, onSignOut }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => (panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const index = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, e.shiftKey);
      e.preventDefault();
      items[index]?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const accountLinks = model.account;
  const auth = model.auth;

  return (
    <div className="md:hidden fixed inset-0 z-50">
      <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={onClose} tabIndex={-1} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        id="mobile-nav-drawer"
        className="absolute top-0 right-0 bottom-0 w-80 max-w-[85vw] max-h-[100dvh] overflow-y-auto overscroll-contain bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-slate-200">
          <span className="text-lg font-bold text-slate-900">Menu</span>
          <button type="button" onClick={onClose} aria-label="Close menu" className="flex items-center justify-center w-11 h-11 text-slate-700 hover:text-blue-600">
            <X className="w-7 h-7" />
          </button>
        </div>

        <nav aria-label="Mobile" className="px-3 py-3 space-y-1">
          {model.primary.map((link) =>
            link.children ? (
              <div key={link.id}>
                <button type="button" onClick={onToggleAddOns} aria-expanded={addOnsExpanded} aria-controls="mobile-addons-list" className={`${rowClass} justify-between`}>
                  {link.label}
                  <ChevronDown className={`w-5 h-5 transition-transform ${addOnsExpanded ? 'rotate-180' : ''}`} />
                </button>
                {addOnsExpanded && (
                  <div id="mobile-addons-list" className="ml-3 pl-3 border-l border-slate-200 space-y-1">
                    {link.children.map((child) => (
                      <Link key={child.id} to={child.to} onClick={onClose} className={rowClass}>
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link key={link.id} to={link.to} onClick={onClose} className={rowClass}>
                {link.label}
              </Link>
            ),
          )}

          {accountLinks.length > 0 && (
            <div className="border-t border-slate-200 pt-3 mt-3 space-y-1">
              {accountLinks.map((l) => (
                <Link key={l.id} to={l.to} onClick={onClose} className={rowClass}>
                  {l.label}
                </Link>
              ))}
            </div>
          )}

          <div className="border-t border-slate-200 pt-3 mt-3 space-y-1">
            <a href={`tel:${businessPhone.replace(/\D/g, '')}`} className={rowClass}>
              <Phone className="w-5 h-5 mr-3" />
              {businessPhone}
            </a>
            {auth === 'logout' ? (
              <>
                {email && <div className="py-2 px-3 text-sm text-slate-600 break-all">{email}</div>}
                <button type="button" onClick={() => { onClose(); onSignOut(); }} className={rowClass}>
                  <LogOut className="w-5 h-5 mr-3" />
                  Sign Out
                </button>
              </>
            ) : (
              <Link to="/login" onClick={onClose} className={rowClass}>
                <LogIn className="w-5 h-5 mr-3" />
                Login
              </Link>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
