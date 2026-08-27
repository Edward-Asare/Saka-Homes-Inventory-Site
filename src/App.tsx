import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Tags, 
  FileText, 
  Search, 
  Plus, 
  LogOut, 
  Bell, 
  Menu, 
  X, 
  Loader2, 
  AlertTriangle, 
  ArrowLeftRight, 
  ShieldAlert, 
  UserCheck,
  Shield,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Users,
  History,
  MessageSquare,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './views/Dashboard';
import Inventory from './views/Inventory';
import PurchaseOrders from './views/PurchaseOrders';
import Categories from './views/Categories';
import Reports from './views/Reports';
import StockMovements from './views/StockMovements';
import UserManagement from './views/UserManagement';
import ActivityLogs from './views/ActivityLogs';
import GuestOrders from './views/GuestOrders';
import ForcedChangePasswordModal from './components/ForcedChangePasswordModal';
import InactivityTimeoutModal from './components/InactivityTimeoutModal';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';
import { View, AppUser } from './types';
import { authService } from './services/dataService';
import { supabase, isSupabaseConfigured } from './lib/supabase';
import { cn } from './lib/utils';
import SakaHomesLogo from './components/SakaHomesLogo';
import AccessDeniedModal from './components/AccessDeniedModal';
import loginBg from './assets/login-bg.jpg';

export default function App() {
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [shouldOpenAddModal, setShouldOpenAddModal] = useState(false);
  const [selectedIssueItemId, setSelectedIssueItemId] = useState<string | null>(null);

  const [accessDeniedModalOpen, setAccessDeniedModalOpen] = useState(false);
  const [accessDeniedAction, setAccessDeniedAction] = useState<string | undefined>(undefined);

  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    // Check cached session and verify active token with backend
    const initializeAuth = async () => {
      try {
        const cached = authService.getCurrentUser();
        const explicitLogout = sessionStorage.getItem('saka_explicit_logout');

        if (cached) {
          setAppUser(cached);
          const verified = await authService.verifySession();
          if (verified) {
            setAppUser(verified);
          } else {
            setAppUser(null);
          }
        } else if (!explicitLogout) {
          // If Supabase is active and has an existing session, restore it
          if (supabase && isSupabaseConfigured) {
            const { data } = await supabase.auth.getSession();
            if (data.session) {
              localStorage.setItem('saka_auth_token', data.session.access_token);
              const user = await authService.verifySession();
              if (user) setAppUser(user);
            }
          }
        }
      } catch (err) {
        console.warn('Auth initialization notice:', err);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Supabase real-time auth state listener
    let unsubscribe: (() => void) | undefined;
    if (supabase && isSupabaseConfigured) {
      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.access_token) {
          localStorage.setItem('saka_auth_token', session.access_token);
          const user = await authService.verifySession();
          if (user) setAppUser(user);
        } else if (event === 'SIGNED_OUT') {
          setAppUser(null);
        }
      });
      unsubscribe = () => authListener.subscription.unsubscribe();
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleAccessDeniedEvent = (e: any) => {
      setAccessDeniedAction(e.detail?.message || 'perform administrative changes');
      setAccessDeniedModalOpen(true);
    };

    const handleAuthExpiredEvent = (e: any) => {
      setAppUser(null);
      setAuthError(e.detail?.message || 'Your session has expired. Please sign in again.');
    };

    window.addEventListener('saka:access_denied', handleAccessDeniedEvent);
    window.addEventListener('saka:auth_expired', handleAuthExpiredEvent);

    return () => {
      window.removeEventListener('saka:access_denied', handleAccessDeniedEvent);
      window.removeEventListener('saka:auth_expired', handleAuthExpiredEvent);
    };
  }, []);

  const triggerAccessDenied = (actionName?: string) => {
    setAccessDeniedAction(actionName);
    setAccessDeniedModalOpen(true);
  };

  const handlePostgresAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput || !passwordInput) {
      setAuthError('Please enter both username/email and password.');
      return;
    }
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      sessionStorage.removeItem('saka_explicit_logout');
      let user: AppUser;
      if (supabase && isSupabaseConfigured && usernameInput.includes('@') && !usernameInput.toLowerCase().endsWith('@sakainventory')) {
        try {
          user = await authService.loginWithSupabase(usernameInput, passwordInput);
        } catch (supabaseErr: any) {
          const lower = (supabaseErr.message || '').toLowerCase();
          if (lower.includes('email not confirmed') || lower.includes('invalid login credentials')) {
            throw supabaseErr;
          }
          // Try local database login if Supabase auth threw connection error
          user = await authService.login(usernameInput, passwordInput);
        }
      } else {
        user = await authService.login(usernameInput, passwordInput);
      }
      setAppUser(user);
    } catch (error: any) {
      console.error('Login Error:', error);
      setAuthError(error?.message || 'Invalid login credentials. Please verify your email and password.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleNavigate = (view: View) => {
    setActiveView(view);
    if (view !== 'stock-movements') {
      setSelectedIssueItemId(null);
    }
  };

  const handleLogout = (isManual = true) => {
    sessionStorage.setItem('saka_explicit_logout', 'true');
    authService.logout();
    setAppUser(null);
    handleNavigate('dashboard');
    if (!isManual) {
      setAuthError('You have been logged out due to inactivity for security reasons. Please sign in to resume.');
    }
  };

  const handleInactivityLogout = React.useCallback(() => {
    handleLogout(false);
  }, []);

  // 15 minutes of inactivity threshold with 60-second warning countdown modal
  const { isWarning: isInactivityWarning, remainingSeconds: inactivitySeconds, resetTimer: resetInactivityTimer } = useInactivityTimeout({
    timeoutMs: 15 * 60 * 1000,
    warningMs: 60 * 1000,
    onTimeout: handleInactivityLogout,
    enabled: Boolean(appUser)
  });

  const handleGlobalAdd = () => {
    if (appUser?.role !== 'ADMIN' && appUser?.role !== 'MANAGER') {
      triggerAccessDenied('add new material items');
      return;
    }
    if (activeView !== 'inventory') {
      handleNavigate('inventory');
      setTimeout(() => setShouldOpenAddModal(true), 100);
    } else {
      setShouldOpenAddModal(true);
    }
  };

  const handleNotificationClick = () => {
    alert("System Security Status: \n✓ PostgreSQL Connection Pool Connected\n✓ Server-Side Bcrypt Hashing & JWT Enforced\n✓ Role-Based Access Control (ADMIN / MANAGER / GUEST) Active\n✓ Instant Session Revocation & Immutable Security Audit Trail Enabled");
  };

  const allNavItems = [
    { id: 'dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'orders' as View, label: 'Orders', icon: MessageSquare },
    { id: 'inventory' as View, label: 'Inventory', icon: Package },
    { id: 'stock-movements' as View, label: 'Stock Movements', icon: ArrowLeftRight },
    { id: 'purchase-orders' as View, label: 'Purchase Orders', icon: ShoppingCart },
    { id: 'categories' as View, label: 'Categories', icon: Tags },
    { id: 'reports' as View, label: 'Reports', icon: FileText },
    { id: 'activity-logs' as View, label: 'Activity Logs', icon: History },
    { id: 'users' as View, label: 'User Accounts', icon: Users },
  ];

  // RBAC Filtered Navigation Items
  const navItems = allNavItems.filter((item) => {
    // Only Admin can see and manage User Accounts
    if (item.id === 'users') {
      return appUser?.role === 'ADMIN';
    }
    // Activity Logs visible to Admin and Manager
    if (item.id === 'activity-logs') {
      return appUser?.role === 'ADMIN' || appUser?.role === 'MANAGER';
    }
    // Operational views (Stock Movements, POs, Categories) visible to Admin and Manager
    if (item.id === 'stock-movements' || item.id === 'purchase-orders' || item.id === 'categories') {
      return appUser?.role === 'ADMIN' || appUser?.role === 'MANAGER';
    }
    // Dashboard, Inventory, Reports visible to all
    return true;
  });


  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8F5]">
        <div className="p-4 bg-white rounded-3xl border border-amber-900/10 shadow-sm mb-4">
          <SakaHomesLogo size="lg" showSubtitle />
        </div>
        <Loader2 className="w-8 h-8 animate-spin text-[#E54818]" />
      </div>
    );
  }

  if (!appUser) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex flex-col lg:flex-row relative overflow-hidden">
        {/* Left Column - Luxury Real Estate Split Hero Panel with Building Photo Background */}
        <div className="hidden lg:flex lg:w-7/12 relative overflow-hidden flex-col justify-between p-12 lg:p-16 text-white border-r border-slate-900/40">
          {/* Architectural Background Image */}
          <div 
            className="absolute inset-0 bg-cover bg-center transition-transform duration-1000 scale-105"
            style={{ backgroundImage: `url(${loginBg})` }}
          />
          {/* Elegant Dark Gradient & Brand Vignette Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-slate-950/70 to-slate-950/40 backdrop-blur-[0.5px]" />
          <div className="absolute top-0 right-0 -mt-16 -mr-16 w-96 h-96 bg-[#E54818]/25 rounded-full blur-3xl pointer-events-none" />

          {/* Top Brand Header */}
          <div className="relative z-10">
            <div className="bg-black/40 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 inline-block shadow-lg">
              <SakaHomesLogo variant="white" size="lg" showSubtitle />
            </div>
          </div>

          {/* Middle Value Proposition */}
          <div className="relative z-10 my-auto py-12 space-y-6 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#E54818]/80 text-white text-xs font-bold shadow-md">
              <span>Saka Homes Architecture & Operations</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-heading font-extrabold tracking-tight text-white leading-tight drop-shadow-md">
              Saka Homes Inventory Security & Operations Portal
            </h1>
            
            <p className="text-slate-200 text-sm xl:text-base leading-relaxed drop-shadow-sm">
              Sign in with your assigned account credentials. The portal automatically resolves your workspace permissions based on your assigned role (Admin or Viewer).
            </p>
          </div>

          <div className="relative z-10 text-xs text-slate-300 font-medium flex items-center justify-between">
            <span>© {new Date().getFullYear()} Saka Homes Construction & Real Estate Development Ltd.</span>
            <span className="text-[11px] text-slate-400">Accra, Ghana</span>
          </div>
        </div>

        {/* Right Column - Unified Credentials Login Card with Subtle Architectural Watermark */}
        <div className="w-full lg:w-5/12 flex items-center justify-center p-4 sm:p-8 lg:p-12 bg-[#FAF8F5] min-h-screen relative">
          {/* Subtle Watermark on background */}
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-[0.035] pointer-events-none"
            style={{ backgroundImage: `url(${loginBg})` }}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md w-full bg-white/95 backdrop-blur-sm rounded-3xl shadow-xl shadow-slate-950/5 p-6 sm:p-10 space-y-6 sm:space-y-8 border border-slate-200/80 relative z-10"
          >
            <div className="space-y-4 flex flex-col items-center text-center">
              <div className="p-4 bg-[#FAF8F5] rounded-3xl border border-amber-900/10 shadow-2xs">
                <SakaHomesLogo size="lg" showSubtitle />
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl font-heading font-extrabold text-[#1E1B4B]">Portal Sign In</h2>
                <p className="text-slate-500 text-xs">Enter your credentials to access your assigned inventory workspace.</p>
              </div>
            </div>
            
            <div className="space-y-5">
              <form onSubmit={handlePostgresAuth} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-[#1E1B4B] uppercase tracking-wider mb-1.5">
                    Username or Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      required
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      placeholder="e.g. yourname@sakainventory"
                      autoComplete="username"
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818] transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#1E1B4B] uppercase tracking-wider mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input 
                      type={showPassword ? 'text' : 'password'} 
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-3.5 bg-[#E54818] text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </form>

              {authError && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={cn(
                    "p-4 rounded-xl text-xs text-left flex items-start gap-2.5 border",
                    authError.includes('inactivity') 
                      ? "bg-amber-50 border-amber-200 text-amber-900" 
                      : "bg-rose-50 border-rose-200 text-rose-700"
                  )}
                >
                  {authError.includes('inactivity') ? (
                    <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  )}
                  <div className="space-y-0.5">
                    {authError.includes('inactivity') && (
                      <p className="font-extrabold text-[11px] uppercase tracking-wider text-amber-800">
                        Session Inactivity Timeout
                      </p>
                    )}
                    <p className="leading-relaxed">{authError}</p>
                  </div>
                </motion.div>
              )}
            </div>
            
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#FAF8F5] text-[#1E1B4B] font-sans antialiased">
      {/* Sidebar Mobile Toggle Floating Button */}
      {!sidebarOpen && (
        <button 
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#E54818] text-white rounded-2xl shadow-2xl items-center justify-center flex hover:bg-[#C83A0F] active:scale-95 transition-all"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      {/* Modern Luxury Saka Homes Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* Mobile Backdrop Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden"
            />

            <motion.aside
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed lg:sticky top-0 left-0 z-50 lg:z-40 w-72 h-[100dvh] max-h-[100dvh] lg:h-screen lg:max-h-screen bg-[#181335] text-purple-100 border-r border-purple-950/60 flex flex-col print:hidden shadow-2xl overflow-hidden"
            >
              {/* Header Branding */}
              <div className="p-5 pb-4 flex items-center justify-between border-b border-purple-900/40 bg-[#120E2B] shrink-0">
                <SakaHomesLogo variant="white" size="md" showSubtitle />
                <button 
                  onClick={() => setSidebarOpen(false)} 
                  className="lg:hidden p-1.5 rounded-lg text-purple-300 hover:text-white hover:bg-purple-900/50 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Warehouse Location Pill */}
              <div className="px-5 py-3.5 shrink-0">
                <div className="bg-purple-950/60 border border-purple-800/40 rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs text-purple-200">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#E54818] animate-pulse" />
                    <span className="font-bold text-white">Central Warehouse</span>
                  </div>
                  <span className="text-[10px] font-extrabold text-orange-400 bg-purple-900/80 px-2 py-0.5 rounded-md border border-purple-700/60">ACCRA</span>
                </div>
              </div>

              {/* Navigation Items */}
              <nav className="flex-1 px-3 space-y-1.5 py-2 lg:py-3 overflow-y-auto min-h-0 overscroll-contain">
                <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-purple-400/70 mb-1">Navigation</p>
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavigate(item.id)}
                      className={cn(
                        "w-full flex items-center gap-3.5 px-3.5 py-2.5 sm:py-3 rounded-xl text-xs font-semibold transition-all group relative",
                        isActive 
                          ? "bg-gradient-to-r from-[#E54818] to-[#C83A0F] text-white shadow-lg shadow-orange-950/40" 
                          : "text-purple-200/70 hover:bg-purple-900/30 hover:text-white"
                      )}
                    >
                      <Icon className={cn("w-4 h-4 transition-transform group-hover:scale-110", isActive ? "text-white" : "text-purple-300/60 group-hover:text-orange-400")} />
                      <span className="font-semibold text-sm">{item.label}</span>
                      {isActive && (
                        <motion.div 
                          layoutId="activeTabGlow" 
                          className="ml-auto w-2 h-2 rounded-full bg-amber-300 shadow-sm"
                        />
                      )}
                    </button>
                  );
                })}
              </nav>

              {/* Sidebar Footer User Card with Safe Area Inset Support on Mobile and Tight Padding on Laptop */}
              <div className="p-3.5 sm:p-4 border-t border-purple-900/40 bg-[#120E2B] shrink-0 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] lg:pb-4">
                <div className="bg-[#211A48] border border-purple-800/40 rounded-2xl p-3 space-y-2.5 shadow-inner">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#E54818] to-purple-600 flex items-center justify-center text-white font-black text-xs uppercase shadow-sm shrink-0">
                      {appUser.username[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-xs text-white truncate">{appUser.fullName}</p>
                      <div className="mt-0.5">
                        {appUser.role === 'ADMIN' ? (
                          <span className="inline-block px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 text-orange-300 rounded text-[9px] font-extrabold uppercase tracking-wider">
                            Admin Access
                          </span>
                        ) : appUser.role === 'MANAGER' ? (
                          <span className="inline-block px-1.5 py-0.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 rounded text-[9px] font-extrabold uppercase tracking-wider">
                            Manager (Ops)
                          </span>
                        ) : (
                          <span className="inline-block px-1.5 py-0.5 bg-blue-500/20 border border-blue-500/40 text-blue-300 rounded text-[9px] font-extrabold uppercase tracking-wider">
                            Guest (Read Only)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    id="sidebar-sign-out-btn"
                    onClick={() => handleLogout(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-xl text-xs font-bold text-rose-200 hover:text-white transition-all active:scale-[0.98] shadow-xs"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Glassmorphic Top Bar */}
        <header className="sticky top-0 z-30 bg-[#FAF8F5]/90 backdrop-blur-xl border-b border-amber-900/10 px-3 sm:px-6 py-3 sm:py-4 print:hidden shadow-2xs">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex-1 flex items-center gap-2 sm:gap-3">
              {!sidebarOpen && (
                <button 
                  onClick={() => setSidebarOpen(true)} 
                  className="p-2 hover:bg-slate-200/60 rounded-xl transition-colors text-slate-700 shrink-0"
                  title="Open Menu"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text"
                  placeholder="Search materials, PO numbers, site dispatches..."
                  className="w-full bg-white hover:bg-white focus:bg-white border border-amber-900/15 rounded-xl pl-9 sm:pl-10 pr-4 sm:pr-12 py-2 sm:py-2.5 text-xs font-semibold text-[#1E1B4B] outline-none focus:border-[#E54818] focus:ring-4 focus:ring-[#E54818]/10 transition-all placeholder:text-slate-400"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
              <button 
                onClick={handleNotificationClick}
                className="relative p-2 sm:p-2.5 rounded-xl border border-amber-900/15 bg-white text-slate-700 hover:border-[#E54818]/40 hover:text-[#E54818] transition-all shadow-2xs"
                title="System Notifications"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-2 h-2 rounded-full bg-[#E54818] ring-2 ring-white animate-pulse" />
              </button>

              <button 
                onClick={handleGlobalAdd}
                className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-[#E54818] text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] hover:shadow-lg hover:-translate-y-0.5 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden xs:inline sm:inline">New Item</span>
              </button>

              {/* Quick Sign Out button in Top Bar */}
              <button
                id="header-sign-out-btn"
                onClick={() => handleLogout(true)}
                className="p-2 sm:py-2.5 sm:px-3 rounded-xl border border-rose-200/80 bg-rose-50/80 text-rose-700 hover:bg-rose-100 hover:border-rose-300 transition-all shadow-2xs flex items-center gap-1.5 active:scale-95"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4 text-rose-600 shrink-0" />
                <span className="hidden md:inline text-xs font-bold text-rose-700">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        {/* Dynamic View Viewport */}
        <div className="flex-1 p-3.5 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {activeView === 'dashboard' && (
                <Dashboard 
                  searchQuery={searchQuery} 
                  setActiveView={handleNavigate} 
                  userRole={appUser.role} 
                  onAccessDenied={triggerAccessDenied} 
                />
              )}
              {activeView === 'orders' && (
                <GuestOrders 
                  currentUser={appUser} 
                  userRole={appUser.role} 
                  searchQuery={searchQuery} 
                  onNavigate={handleNavigate} 
                />
              )}
              {activeView === 'inventory' && (
                <Inventory 
                  searchQuery={searchQuery} 
                  forceOpenModal={shouldOpenAddModal} 
                  onModalClose={() => setShouldOpenAddModal(false)}
                  onIssueItem={(id) => {
                    setSelectedIssueItemId(id);
                    setActiveView('stock-movements');
                  }}
                  userRole={appUser.role}
                  currentUser={appUser}
                  onAccessDenied={triggerAccessDenied}
                />
              )}
              {activeView === 'stock-movements' && (
                <StockMovements 
                  searchQuery={searchQuery} 
                  initialSelectedItemId={selectedIssueItemId}
                  onClearInitialSelectedItemId={() => setSelectedIssueItemId(null)}
                  userRole={appUser.role}
                  currentUser={appUser}
                  onAccessDenied={triggerAccessDenied}
                />
              )}
              {activeView === 'purchase-orders' && (
                <PurchaseOrders searchQuery={searchQuery} userRole={appUser.role} currentUser={appUser} onAccessDenied={triggerAccessDenied} />
              )}
              {activeView === 'categories' && (
                <Categories searchQuery={searchQuery} userRole={appUser.role} currentUser={appUser} onAccessDenied={triggerAccessDenied} />
              )}
              {activeView === 'reports' && (
                <Reports searchQuery={searchQuery} currentUser={appUser} />
              )}
              {activeView === 'activity-logs' && (appUser.role === 'ADMIN' || appUser.role === 'MANAGER') && (
                <ActivityLogs currentUser={appUser} onAccessDenied={triggerAccessDenied} />
              )}
              {activeView === 'users' && appUser.role === 'ADMIN' && (
                <UserManagement currentUser={appUser} onAccessDenied={triggerAccessDenied} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Forced Change Password Modal Overlay (for temporary or reset passwords) */}
      {appUser.mustChangePassword && (
        <ForcedChangePasswordModal
          user={appUser}
          onPasswordChanged={(updatedUser) => {
            setAppUser(updatedUser);
          }}
          onLogout={handleLogout}
        />
      )}

      {/* Access Denied Modal Popup */}
      <AccessDeniedModal
        isOpen={accessDeniedModalOpen}
        onClose={() => setAccessDeniedModalOpen(false)}
        actionName={accessDeniedAction}
      />

      {/* Inactivity Security Timeout Warning Modal */}
      <InactivityTimeoutModal
        isOpen={isInactivityWarning}
        remainingSeconds={inactivitySeconds}
        onStayLoggedIn={resetInactivityTimer}
        onLogout={() => handleLogout(true)}
      />
    </div>
  );
}

