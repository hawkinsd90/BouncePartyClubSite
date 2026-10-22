import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { NavLink } from '../../../lib/core/navLinks';
import { useDismissable } from '../../../hooks/core/useBodyScrollLock';

interface Props {
  links: NavLink[];
  addOnsOpen: boolean;
  onToggleAddOns: () => void;
  onClose: () => void;
}

const linkClass = 'whitespace-nowrap text-sm xl:text-base text-slate-700 hover:text-blue-600 font-medium transition-colors min-h-[44px] flex items-center';

// Desktop navigation: ONE row. A link with children (Party Add-Ons with the Admin-configured menu groups) is a dropdown that opens on
// click and closes on Escape, a click outside, or choosing a link.
export function SiteNav({ links, addOnsOpen, onToggleAddOns, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useDismissable(ref, addOnsOpen, onClose);

  return (
    <nav aria-label="Main" className="hidden md:flex items-center gap-x-4 lg:gap-x-6 xl:gap-x-8 ml-4 lg:ml-8">
      {links.map((link) =>
        link.children ? (
          <div key={link.id} ref={ref} className="relative">
            <button
              type="button"
              onClick={onToggleAddOns}
              aria-expanded={addOnsOpen}
              aria-haspopup="true"
              aria-controls="addons-menu-panel"
              className={`${linkClass} gap-1`}
            >
              {link.label}
              <ChevronDown className={`w-4 h-4 transition-transform ${addOnsOpen ? 'rotate-180' : ''}`} />
            </button>
            {addOnsOpen && (
              <div id="addons-menu-panel" className="absolute left-0 mt-1 w-64 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50">
                {link.children.map((child) => (
                  <Link key={child.id} to={child.to} onClick={onClose} className="block px-4 py-3 text-slate-700 hover:bg-blue-50 hover:text-blue-700 font-medium min-h-[44px]">
                    {child.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Link key={link.id} to={link.to} className={linkClass} onClick={onClose}>
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}
