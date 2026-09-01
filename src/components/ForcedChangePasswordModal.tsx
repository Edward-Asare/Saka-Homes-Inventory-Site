import React, { useState } from 'react';
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { AppUser } from '../types';
import { authService } from '../services/dataService';
import { cn } from '../lib/utils';

interface ForcedChangePasswordModalProps {
  user: AppUser;
  onPasswordChanged: (updatedUser: AppUser) => void;
  onLogout: () => void;
}

export default function ForcedChangePasswordModal({ user, onPasswordChanged, onLogout }: ForcedChangePasswordModalProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Password strength checks
  const hasMinLength = newPassword.length >= 8;
  const hasLetter = /[A-Za-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const isFormValid = hasMinLength && hasLetter && hasNumber && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      if (!hasMinLength) setError('Password must be at least 8 characters long.');
      else if (!hasLetter) setError('Password must contain at least one letter.');
      else if (!hasNumber) setError('Password must contain at least one number.');
      else if (!passwordsMatch) setError('Passwords do not match.');
      else setError('Please satisfy all password security requirements.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await authService.changePassword(newPassword);
      if (res && res.user) {
        onPasswordChanged(res.user);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="forced-password-modal-backdrop" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E1B4B]/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-2xl max-w-md w-full p-7 space-y-6 shadow-2xl border border-amber-900/20"
      >
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto shadow-inner">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-heading font-semibold text-[#1E1B4B]">
            Password Update Required
          </h2>
          <p className="text-sm text-slate-500 max-w-xs mx-auto">
            Welcome, <span className="font-bold text-[#1E1B4B]">{user.fullName}</span>. For your account security, you must set a new personal password to continue.
          </p>
        </div>

        {error && (
          <div id="password-error-alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <form id="forced-password-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#1E1B4B] uppercase tracking-[0.12em] mb-1.5">
              New Password *
            </label>
            <div className="relative">
              <input
                id="new-password-input"
                type={showNewPassword ? 'text' : 'password'}
                required
                autoFocus
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Enter new password (min 8 chars, 1 letter, 1 number)"
                className="w-full pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818]"
              />
              <button
                id="toggle-new-password-visibility-btn"
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#1E1B4B] uppercase tracking-[0.12em] mb-1.5">
              Confirm New Password *
            </label>
            <div className="relative">
              <input
                id="confirm-password-input"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Re-enter new password"
                className={cn(
                  "w-full pl-4 pr-10 py-2.5 bg-slate-50 border rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2",
                  confirmPassword.length > 0 && !passwordsMatch 
                    ? "border-rose-300 focus:ring-rose-400" 
                    : "border-slate-200 focus:ring-[#E54818]"
                )}
              />
              <button
                id="toggle-confirm-password-visibility-btn"
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Password Policy Checklist */}
          <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2 text-[11px]">
            <p className="font-semibold text-slate-700 uppercase tracking-wider text-[10px]">
              Password Requirements
            </p>
            <div className="space-y-1.5 font-medium">
              <div className={cn("flex items-center gap-2 transition-colors", hasMinLength ? "text-emerald-700 font-bold" : "text-slate-400")}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>At least 8 characters long</span>
              </div>
              <div className={cn("flex items-center gap-2 transition-colors", hasLetter ? "text-emerald-700 font-bold" : "text-slate-400")}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Contains at least one letter (a-z, A-Z)</span>
              </div>
              <div className={cn("flex items-center gap-2 transition-colors", hasNumber ? "text-emerald-700 font-bold" : "text-slate-400")}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Contains at least one number (0-9)</span>
              </div>
              <div className={cn("flex items-center gap-2 transition-colors", passwordsMatch ? "text-emerald-700 font-bold" : "text-slate-400")}>
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Passwords match</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <button
              id="set-password-submit-btn"
              type="submit"
              disabled={!isFormValid || loading}
              className="w-full py-3 bg-[#E54818] text-white rounded-lg text-sm font-semibold hover:bg-[#C83A0F] active:scale-98 transition-all disabled:opacity-50 disabled:pointer-events-none shadow-md shadow-orange-600/20 flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{loading ? 'Securing Account...' : 'Set Password & Enter System'}</span>
            </button>

            <button
              id="cancel-logout-btn"
              type="button"
              onClick={onLogout}
              className="w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
              Cancel and Log Out
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
