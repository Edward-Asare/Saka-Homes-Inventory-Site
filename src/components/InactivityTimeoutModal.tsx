import React, { useEffect } from 'react';
import { Clock, ShieldAlert, LogOut, RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface InactivityTimeoutModalProps {
  isOpen: boolean;
  remainingSeconds: number;
  onStayLoggedIn: () => void;
  onLogout: () => void;
}

export default function InactivityTimeoutModal({
  isOpen,
  remainingSeconds,
  onStayLoggedIn,
  onLogout
}: InactivityTimeoutModalProps) {
  // Allow user to hit Enter to stay signed in
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        onStayLoggedIn();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onStayLoggedIn]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          id="inactivity-modal-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md"
        >
          <motion.div
            id="inactivity-modal-card"
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200/80 p-6 sm:p-7 overflow-hidden text-center"
          >
            {/* Top decorative amber/orange accent */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-500 via-[#E54818] to-rose-500" />

            <div className="flex flex-col items-center space-y-4 pt-2">
              {/* Pulsing Clock / Security Shield Badge */}
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-inner">
                  <Clock className="w-8 h-8 animate-pulse text-[#E54818]" />
                </div>
                <div className="absolute -bottom-1 -right-1 p-1 bg-white rounded-full shadow-sm border border-slate-100">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                </div>
              </div>

              {/* Title and Descriptions */}
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100/80 text-amber-900 text-[11px] font-semibold uppercase tracking-wider">
                  <span>Session Expiring Soon</span>
                </div>
                <h3 className="text-xl font-heading font-semibold text-[#1E1B4B]">
                  Are You Still There?
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed max-w-xs mx-auto">
                  You have been inactive for a while. To protect warehouse inventory data and security, you will be automatically logged out in:
                </p>
              </div>

              {/* Countdown Digital Timer Block */}
              <div className="w-full bg-slate-50 border border-amber-200/60 rounded-2xl p-4 flex flex-col items-center justify-center space-y-1 shadow-inner">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold font-mono text-[#E54818] tracking-tight">
                    {String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:
                    {String(remainingSeconds % 60).padStart(2, '0')}
                  </span>
                  <span className="text-xs font-bold text-slate-400 uppercase">seconds</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Press <kbd className="px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded font-mono text-[10px] font-bold">Enter</kbd> to keep your session active
                </p>
              </div>

              {/* Action Buttons */}
              <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                <button
                  id="inactivity-btn-stay"
                  type="button"
                  onClick={onStayLoggedIn}
                  className="w-full py-3 px-4 bg-[#E54818] hover:bg-[#C83A0F] text-white rounded-lg text-sm font-semibold shadow-md shadow-orange-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Stay Signed In</span>
                </button>

                <button
                  id="inactivity-btn-logout"
                  type="button"
                  onClick={onLogout}
                  className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4 text-slate-500" />
                  <span>Sign Out Now</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
