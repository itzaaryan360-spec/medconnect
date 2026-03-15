import React from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Heart } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const links = [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/reports', label: 'Reports' },
    { to: '/3d-view', label: '3D View' },
    { to: '/emergency', label: 'Emergency' },
    { to: '/caretaker', label: 'Caretaker' },
    { to: '/wearable', label: 'Wearable' },
  ];

  return (
    <nav className={`sticky top-0 z-50 border-b backdrop-blur-md transition-colors duration-300 ${isDark
      ? 'bg-slate-900/90 border-slate-800 shadow-slate-900/50'
      : 'bg-white/90 border-slate-200 shadow-sm'
      } shadow`}>
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${isDark ? 'bg-teal-500/20' : 'bg-teal-50'
            }`}>
            <Heart className="h-5 w-5 text-teal-500 group-hover:scale-110 transition-transform" />
          </div>
          <span className={`text-xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-slate-800'}`}>
            Med<span className="text-teal-500">Connect</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map(({ to, label }) => (
            <Link
              key={to} to={to}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isDark
                ? 'text-slate-300 hover:text-white hover:bg-slate-800'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`relative flex h-9 w-16 items-center rounded-full border p-0.5 transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${isDark
              ? 'bg-slate-700 border-slate-600 focus:ring-offset-slate-900'
              : 'bg-slate-200 border-slate-300 focus:ring-offset-white'
              }`}
          >
            <Moon className={`absolute left-1.5 h-4 w-4 transition-opacity ${isDark ? 'text-teal-400 opacity-100' : 'opacity-30 text-slate-400'}`} />
            <Sun className={`absolute right-1.5 h-4 w-4 transition-opacity ${!isDark ? 'text-amber-400 opacity-100' : 'opacity-30 text-slate-500'}`} />
            <span className={`absolute h-7 w-7 rounded-full shadow-md transition-all duration-300 ${isDark ? 'left-0.5 bg-slate-900' : 'left-[calc(100%-1.875rem)] bg-white'
              }`} />
          </button>

          <Link
            to="/auth?mode=login"
            className={`hidden sm:block text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${isDark ? 'text-slate-300 hover:text-white hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
          >
            Sign In
          </Link>
          <Link
            to="/auth?mode=signup"
            className="bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;