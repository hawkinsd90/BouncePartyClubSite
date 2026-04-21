import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Phone, Mail, LogOut, LogIn, ShoppingCart, Menu, X, Instagram, Facebook } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { SafeStorage } from '../../lib/safeStorage';
import { useState, useEffect } from 'react';
import { notifyError } from '../../lib/notifications';
import { getPublicBusinessSettings } from '../../lib/adminSettingsCache';

export function Layout() {
  const { user, isAdmin, hasRole, signOut } = useAuth();
  const navigate = useNavigate();
  const [cartCount, setCartCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [businessAddress, setBusinessAddress] = useState('');
  const [businessPhone, setBusinessPhone] = useState('(313) 889-3860');
  const [businessEmail, setBusinessEmail] = useState('admin@bouncepartyclub.com');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [facebookUrl, setFacebookUrl] = useState('');

  useEffect(() => {
    getPublicBusinessSettings().then(settings => {
      if (settings.business_address) setBusinessAddress(settings.business_address);
      if (settings.business_phone) setBusinessPhone(settings.business_phone);
      if (settings.business_email) setBusinessEmail(settings.business_email);
      if (settings.instagram_url) setInstagramUrl(settings.instagram_url);
      if (settings.facebook_url) setFacebookUrl(settings.facebook_url);
    }).catch(err => {
      console.error('Exception loading business settings:', err);
    });
  }, []);

  useEffect(() => {
    const updateCartCount = () => {
      const items = SafeStorage.getItem<any[]>('bpc_cart');
      if (items) {
        const total = items.reduce((sum: number, item: any) => sum + item.qty, 0);
        setCartCount(total);
      } else {
        setCartCount(0);
      }
    };

    updateCartCount();
    window.addEventListener('storage', updateCartCount);
    window.addEventListener('bpc-cart-updated', updateCartCount);

    return () => {
      window.removeEventListener('storage', updateCartCount);
      window.removeEventListener('bpc-cart-updated', updateCartCount);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Sign out error:', error);
      notifyError('Failed to sign out. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link
              to="/"
              className="flex items-center space-x-2 sm:space-x-3"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setMobileMenuOpen(false);
              }}
            >
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club"
                className="h-10 sm:h-12 w-auto"
              />
              <span className="text-lg sm:text-xl font-bold text-slate-900">
                Bounce Party Club
              </span>
            </Link>

            <nav className="hidden md:flex items-center space-x-8">
              <Link
                to="/catalog"
                className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
              >
                Browse Inflatables
              </Link>
              <Link
                to="/contact"
                className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
              >
                Get Quote
              </Link>
              <Link
                to="/about"
                className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
              >
                About Us
              </Link>
              {user && (
                <Link
                  to="/my-orders"
                  className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
                >
                  My Orders
                </Link>
              )}
              {isAdmin && (
                <Link
                  to="/admin"
                  className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
                >
                  Admin
                </Link>
              )}
              {(isAdmin || hasRole('CREW')) && (
                <Link
                  to="/crew"
                  className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
                >
                  Crew
                </Link>
              )}
            </nav>

            <div className="flex items-center space-x-2 sm:space-x-4">
              <a
                href={`tel:${businessPhone.replace(/\D/g, '')}`}
                className="hidden lg:flex items-center text-slate-600 hover:text-blue-600 transition-colors min-h-[44px]"
              >
                <Phone className="w-5 h-5 mr-2" />
                <span className="font-medium">{businessPhone}</span>
              </a>
              <div className="hidden md:flex items-center space-x-4">
                {user ? (
                  <div className="flex items-center space-x-3">
                    <span className="text-sm text-slate-600 font-medium">
                      {user.email}
                    </span>
                    <button
                      onClick={handleSignOut}
                      className="flex items-center text-slate-600 hover:text-blue-600 transition-colors min-h-[44px] px-2"
                    >
                      <LogOut className="w-5 h-5 mr-2" />
                      <span className="font-medium">Sign Out</span>
                    </button>
                  </div>
                ) : (
                  <Link
                    to="/login"
                    className="flex items-center text-slate-600 hover:text-blue-600 transition-colors min-h-[44px] px-2"
                  >
                    <LogIn className="w-5 h-5 mr-2" />
                    <span className="font-medium">Login</span>
                  </Link>
                )}
              </div>
              <Link
                to="/quote"
                className="relative flex items-center justify-center w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors"
                title="View Cart"
                onClick={() => setMobileMenuOpen(false)}
              >
                <ShoppingCart className="w-6 h-6 text-white" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </Link>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden flex items-center justify-center w-11 h-11 text-slate-700 hover:text-blue-600 transition-colors"
                aria-label="Toggle menu"
              >
                {mobileMenuOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200">
            <nav className="px-4 py-4 space-y-1">
              <Link
                to="/catalog"
                className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                onClick={() => setMobileMenuOpen(false)}
              >
                Browse Inflatables
              </Link>
              <Link
                to="/contact"
                className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                onClick={() => setMobileMenuOpen(false)}
              >
                Get Quote
              </Link>
              <Link
                to="/about"
                className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                onClick={() => setMobileMenuOpen(false)}
              >
                About Us
              </Link>
              {user && (
                <Link
                  to="/my-orders"
                  className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  My Orders
                </Link>
              )}
              {isAdmin && (
                <Link
                  to="/admin"
                  className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Admin
                </Link>
              )}
              {(isAdmin || hasRole('CREW')) && (
                <Link
                  to="/crew"
                  className="block text-slate-700 hover:text-blue-600 font-medium py-3 px-2 transition-colors text-base rounded-lg hover:bg-blue-50"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Crew
                </Link>
              )}
              <div className="border-t border-slate-200 pt-3 mt-3 space-y-1">
                <a
                  href={`tel:${businessPhone.replace(/\D/g, '')}`}
                  className="flex items-center text-slate-600 hover:text-blue-600 py-3 px-2 transition-colors min-h-[44px] rounded-lg hover:bg-blue-50"
                >
                  <Phone className="w-5 h-5 mr-3" />
                  <span className="font-medium">{businessPhone}</span>
                </a>
                {user ? (
                  <>
                    <div className="py-3 px-2 text-sm text-slate-600 font-medium">
                      {user.email}
                    </div>
                    <button
                      onClick={() => {
                        handleSignOut();
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center text-slate-600 hover:text-blue-600 py-3 px-2 transition-colors w-full text-left min-h-[44px] rounded-lg hover:bg-blue-50"
                    >
                      <LogOut className="w-5 h-5 mr-3" />
                      <span className="font-medium">Sign Out</span>
                    </button>
                  </>
                ) : (
                  <Link
                    to="/login"
                    className="flex items-center text-slate-600 hover:text-blue-600 py-3 px-2 transition-colors min-h-[44px] rounded-lg hover:bg-blue-50"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <LogIn className="w-5 h-5 mr-3" />
                    <span className="font-medium">Login</span>
                  </Link>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="bg-slate-900 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="mb-4">
                <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
                  <img
                    src="/bounce party club logo.png"
                    alt="Bounce Party Club"
                    className="h-16 w-auto hover:opacity-80 transition-opacity"
                  />
                </Link>
              </div>
              <p className="text-slate-400 text-sm">
                {businessAddress}
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Quick Links</h3>
              <ul className="space-y-2 text-sm text-slate-400">
                <li>
                  <Link to="/catalog" className="hover:text-white transition-colors">
                    Browse Inflatables
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className="hover:text-white transition-colors">
                    Get a Quote
                  </Link>
                </li>
                <li>
                  <Link to="/about" className="hover:text-white transition-colors">
                    About Us
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold mb-4">Contact Us</h3>
              <ul className="space-y-2 text-sm text-slate-400">
                <li className="flex items-center">
                  <Phone className="w-4 h-4 mr-2" />
                  <a href={`tel:${businessPhone.replace(/\D/g, '')}`} className="hover:text-white transition-colors">
                    {businessPhone}
                  </a>
                </li>
                <li className="flex items-center">
                  <Mail className="w-4 h-4 mr-2" />
                  <a
                    href={`mailto:${businessEmail}`}
                    className="hover:text-white transition-colors"
                  >
                    {businessEmail}
                  </a>
                </li>
              </ul>
              <div className="mt-4">
                <h3 className="font-semibold mb-3">Follow Us</h3>
                <div className="flex items-center space-x-3">
                  {instagramUrl ? (
                    <a
                      href={instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800 hover:bg-blue-600 transition-colors"
                      aria-label="Instagram"
                    >
                      <Instagram className="w-5 h-5" />
                    </a>
                  ) : (
                    <a
                      href="https://instagram.com/bouncepartyclub"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800 hover:bg-blue-600 transition-colors"
                      aria-label="Instagram"
                    >
                      <Instagram className="w-5 h-5" />
                    </a>
                  )}
                  {facebookUrl ? (
                    <a
                      href={facebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800 hover:bg-blue-600 transition-colors"
                      aria-label="Facebook"
                    >
                      <Facebook className="w-5 h-5" />
                    </a>
                  ) : (
                    <a
                      href="https://www.facebook.com/bouncepartyclub"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center w-9 h-9 rounded-full bg-slate-800 hover:bg-blue-600 transition-colors"
                      aria-label="Facebook"
                    >
                      <Facebook className="w-5 h-5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 mt-8 pt-8 text-center text-sm text-slate-400">
            <p>&copy; {new Date().getFullYear()} Bounce Party Club LLC. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
