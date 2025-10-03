import { Link, Outlet, useNavigate } from 'react-router-dom';
import { PartyPopper, Phone, Mail, LogOut, LogIn, ShoppingCart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';

export function Layout() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const updateCartCount = () => {
      const cart = localStorage.getItem('bpc_cart');
      if (cart) {
        const items = JSON.parse(cart);
        const total = items.reduce((sum: number, item: any) => sum + item.qty, 0);
        setCartCount(total);
      } else {
        setCartCount(0);
      }
    };

    updateCartCount();
    window.addEventListener('storage', updateCartCount);
    const interval = setInterval(updateCartCount, 1000);

    return () => {
      window.removeEventListener('storage', updateCartCount);
      clearInterval(interval);
    };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center space-x-2">
              <PartyPopper className="w-8 h-8 text-blue-600" />
              <span className="text-xl font-bold text-slate-900">
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
              {role === 'ADMIN' && (
                <Link
                  to="/admin"
                  className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
                >
                  Admin
                </Link>
              )}
              {(role === 'ADMIN' || role === 'CREW') && (
                <Link
                  to="/crew"
                  className="text-slate-700 hover:text-blue-600 font-medium transition-colors"
                >
                  Crew
                </Link>
              )}
            </nav>

            <div className="flex items-center space-x-4">
              <a
                href="tel:+13138893860"
                className="hidden sm:flex items-center text-slate-600 hover:text-blue-600 transition-colors"
              >
                <Phone className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">(313) 889-3860</span>
              </a>
              {user ? (
                <button
                  onClick={handleSignOut}
                  className="flex items-center text-slate-600 hover:text-blue-600 transition-colors"
                >
                  <LogOut className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Sign Out</span>
                </button>
              ) : (
                <Link
                  to="/login"
                  className="flex items-center text-slate-600 hover:text-blue-600 transition-colors"
                >
                  <LogIn className="w-4 h-4 mr-1" />
                  <span className="text-sm font-medium">Login</span>
                </Link>
              )}
              <Link
                to="/quote"
                className="relative flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors"
                title="View Cart"
              >
                <ShoppingCart className="w-5 h-5 text-white" />
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="bg-slate-900 text-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center space-x-2 mb-4">
                <PartyPopper className="w-6 h-6 text-blue-400" />
                <span className="font-bold text-lg">Bounce Party Club</span>
              </div>
              <p className="text-slate-400 text-sm">
                4426 Woodward St
                <br />
                Wayne, MI 48184
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
                  <a href="tel:+13138893860" className="hover:text-white transition-colors">
                    (313) 889-3860
                  </a>
                </li>
                <li className="flex items-center">
                  <Mail className="w-4 h-4 mr-2" />
                  <a
                    href="mailto:info@bouncepartyclub.com"
                    className="hover:text-white transition-colors"
                  >
                    info@bouncepartyclub.com
                  </a>
                </li>
              </ul>
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
