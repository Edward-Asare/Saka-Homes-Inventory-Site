import React from 'react';
import { ShieldAlert, Lock, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AccessDeniedModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionName?: string;
}

export default function AccessDeniedModal({ isOpen, onClose, actionName }: AccessDeniedModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 overflow-hidden"
          >
            {/* Top decorative accent */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600" />

            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center space-y-4 pt-2">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-inner">
                <ShieldAlert className="w-8 h-8" />
              </div>

              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100/80 text-rose-800 text-[11px] font-extrabold uppercase tracking-wider">
                  <Lock className="w-3 h-3" />
                  <span>Access Denied</span>
                </div>
                <h3 className="text-xl font-heading font-extrabold text-[#1E1B4B]">
                  Admin Authorization Required
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed max-w-xs mx-auto">
                  {actionName 
                    ? `You do not have permission to ${actionName}. Guest accounts have read-only permissions across Saka Homes.`
                    : 'Your account is in Guest Mode (Read-Only). Modifying inventory, issuing stock, or creating orders requires Admin credentials.'}
                </p>
              </div>

              <div className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 text-left text-xs space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>Current Session Role:</span>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] uppercase font-black">
                    GUEST (READ ONLY)
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal">
                  To perform administrative modifications, please log out and sign in using an <strong className="text-slate-700">Admin Account</strong> (<code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]">admin@sakainventory</code>).
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-full py-3 bg-[#1E1B4B] hover:bg-[#2B1A70] text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-[0.98]"
              >
                Acknowledge & Dismiss
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
