import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LogIn, LogOut, User } from 'lucide-react';
import type { NavLink } from '../../../lib/core/navLinks';
import { useDismissable } from '../../../hooks/core/useBodyScrollLock';

interface Props {
  signedIn: boolean;
  email?: string | null;
  links: NavLink[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSignOut: () => void;
}

// Desktop account area: Login for a visitor; for a signed-in user a menu with My Orders, Admin / Crew by role, and Sign Out.
export function AccountMenu({ signedIn, email, links, open, onToggle, onClose, onSignOut }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(ref, open, onClose);

  if (!signedIn) {
    return (
      <Link to="/login" className="flex items-center text-slate-600 hover:text-blue-600 transition-colors min-h-[44px] px-2">
        <LogIn className="w-5 h-5 mr-2" />
        <span className="font-medium">Login</span>
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="account-menu-panel"
        className="flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors min-h-[44px] px-2"
      >
        <User className="w-5 h-5" />
        <span className="hidden xl:inline font-medium max-w-[12rem] truncate">{email || 'Account'}</span>
        <span className="xl:hidden font-medium">Account</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id="account-menu-panel" className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
          {links.map((l) => (
            <Link key={l.id} to={l.to} onClick={onClose} className="block px-4 py-3 text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium min-h-[44px]">
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => { onClose(); onSignOut(); }}
            className="w-full flex items-center px-4 py-3 text-left text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium min-h-[44px] border-t border-slate-100"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
