import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  Eye, 
  KeyRound, 
  Power, 
  Search, 
  RefreshCw, 
  Check, 
  Copy, 
  AlertTriangle, 
  X, 
  Clock, 
  Activity,
  History,
  Lock,
  UserX,
  UserCheck,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppUser, UserRole, SecurityAuditLog } from '../types';
import { authService } from '../services/dataService';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface UserManagementProps {
  currentUser: AppUser;
  onAccessDenied?: (actionName: string) => void;
}

export default function UserManagement({ currentUser, onAccessDenied }: UserManagementProps) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [isStatusConfirmModalOpen, setIsStatusConfirmModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);

  // Form states
  const [fullNameInput, setFullNameInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('GUEST');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Temporary password display modal
  const [tempPasswordModal, setTempPasswordModal] = useState<{
    isOpen: boolean;
    username: string;
    fullName: string;
    temporaryPassword: string;
    isReset: boolean;
  }>({
    isOpen: false,
    username: '',
    fullName: '',
    temporaryPassword: '',
    isReset: false
  });

  const [copied, setCopied] = useState(false);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await authService.getUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load user accounts.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      setLogsLoading(true);
      const data = await authService.getAuditLogs();
      setAuditLogs(data);
    } catch (err: any) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const handleCopyPassword = () => {
    if (tempPasswordModal.temporaryPassword) {
      navigator.clipboard.writeText(tempPasswordModal.temporaryPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullNameInput.trim() || !usernameInput.trim()) {
      setError('Please provide both full name and username.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await authService.createUser({
        fullName: fullNameInput.trim(),
        username: usernameInput.trim().toLowerCase(),
        role: selectedRole
      });

      setIsCreateModalOpen(false);
      setFullNameInput('');
      setUsernameInput('');
      setSelectedRole('GUEST');

      // Open one-time temporary password display
      setTempPasswordModal({
        isOpen: true,
        username: res.user.username,
        fullName: res.user.fullName,
        temporaryPassword: res.temporaryPassword,
        isReset: false
      });

      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to create user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (selectedUser.id === currentUser.id) {
      setError('You cannot modify your own role.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await authService.updateUserRole(selectedUser.id, selectedRole);
      setIsRoleModalOpen(false);
      setSelectedUser(null);
      setSuccessMessage(`Updated role for ${selectedUser.fullName} to ${selectedRole}.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to update user role.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await authService.resetUserPassword(selectedUser.id);
      setIsResetPasswordModalOpen(false);

      setTempPasswordModal({
        isOpen: true,
        username: selectedUser.username,
        fullName: selectedUser.fullName,
        temporaryPassword: res.temporaryPassword,
        isReset: true
      });

      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedUser) return;

    if (selectedUser.id === currentUser.id && selectedUser.isActive) {
      setError('You cannot deactivate your own active administrator account.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const newStatus = !selectedUser.isActive;
      await authService.updateUserStatus(selectedUser.id, newStatus);
      setIsStatusConfirmModalOpen(false);
      setSuccessMessage(`Account ${selectedUser.username} has been ${newStatus ? 'activated' : 'deactivated'}.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to update account status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;

    if (selectedUser.id === currentUser.id) {
      setError('You cannot delete your own active administrator account.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await authService.deleteUser(selectedUser.id);
      setIsDeleteModalOpen(false);
      setSuccessMessage(res.message || `User account "${selectedUser.username}" was permanently deleted.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setSelectedUser(null);
      fetchUsers();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete user account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered users
  const filteredUsers = users.filter((u) => {
    const matchesSearch = 
      u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = 
      roleFilter === 'ALL' || 
      (roleFilter === 'GUEST' ? (u.role === 'GUEST' || u.role === 'VIEWER') : u.role === roleFilter);
    const matchesStatus = 
      statusFilter === 'ALL' || 
      (statusFilter === 'ACTIVE' && u.isActive !== false) || 
      (statusFilter === 'INACTIVE' && u.isActive === false);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const totalUsersCount = users.length;
  const activeUsersCount = users.filter(u => u.isActive !== false).length;
  const adminCount = users.filter(u => u.role === 'ADMIN').length;
  const pendingPasswordCount = users.filter(u => u.mustChangePassword).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-amber-900/10 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#E54818] to-purple-800 flex items-center justify-center text-white shadow-md shadow-orange-950/10">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-heading font-extrabold text-[#1E1B4B]">
                User & Security Management
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-orange-100 text-[#C83A0F] border border-orange-200 uppercase tracking-wider">
                Admin Area
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Enforce server-side role permissions, issue temporary credentials, and inspect security audit trails.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab(activeTab === 'users' ? 'audit' : 'users')}
            className={cn(
              "px-4 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-2",
              activeTab === 'audit'
                ? "bg-[#1E1B4B] text-white border-[#1E1B4B]"
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            <History className="w-4 h-4" />
            <span>{activeTab === 'audit' ? 'View Accounts' : 'Audit Logs'}</span>
          </button>

          <button
            onClick={() => {
              setFullNameInput('');
              setUsernameInput('');
              setSelectedRole('GUEST');
              setError(null);
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#E54818] text-white rounded-xl text-xs font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] active:scale-95 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create User</span>
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4.5 rounded-2xl border border-amber-900/10 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider">Total Accounts</span>
            <Users className="w-4 h-4 text-[#1E1B4B]" />
          </div>
          <p className="text-2xl font-black text-[#1E1B4B]">{totalUsersCount}</p>
          <p className="text-[11px] text-slate-500 font-medium">Registered in PostgreSQL</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-amber-900/10 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-emerald-600">
            <span className="text-xs font-bold uppercase tracking-wider">Active Status</span>
            <UserCheck className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-emerald-600">{activeUsersCount}</p>
          <p className="text-[11px] text-slate-500 font-medium">Authorized to authenticate</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-amber-900/10 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-orange-600">
            <span className="text-xs font-bold uppercase tracking-wider">Administrators</span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-[#E54818]">{adminCount}</p>
          <p className="text-[11px] text-slate-500 font-medium">Full governance control</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-amber-900/10 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-amber-600">
            <span className="text-xs font-bold uppercase tracking-wider">Pending Password</span>
            <KeyRound className="w-4 h-4" />
          </div>
          <p className="text-2xl font-black text-amber-600">{pendingPasswordCount}</p>
          <p className="text-[11px] text-slate-500 font-medium">First-login change required</p>
        </div>
      </div>

      {/* Notifications / Alerts */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="p-1 hover:bg-rose-100 rounded-lg text-rose-600">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-600">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Tab Content */}
      {activeTab === 'users' ? (
        <div className="bg-white rounded-3xl border border-amber-900/10 shadow-sm overflow-hidden space-y-4 p-6">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-2 border-b border-slate-100">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by name or username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818] transition-all"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none"
              >
                <option value="ALL">All Roles</option>
                <option value="ADMIN">Admin</option>
                <option value="MANAGER">Manager (Operations)</option>
                <option value="GUEST">Guest (Viewer)</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Deactivated</option>
              </select>

              <button
                onClick={fetchUsers}
                disabled={loading}
                className="p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 transition-colors"
                title="Refresh users"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-[#E54818]")} />
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] text-slate-500 font-extrabold uppercase tracking-wider border-b border-slate-200/80">
                  <th className="py-3.5 px-4 rounded-l-xl">User Account</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Password Policy</th>
                  <th className="py-3.5 px-4">Last Login</th>
                  <th className="py-3.5 px-4">Created Date</th>
                  <th className="py-3.5 px-4 text-right rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      {loading ? 'Loading user accounts...' : 'No user accounts match your filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#1E1B4B] to-purple-600 text-white font-black text-xs flex items-center justify-center uppercase shadow-2xs">
                              {u.username[0]}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-[#1E1B4B]">{u.fullName}</p>
                                {isSelf && (
                                  <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 text-[9px] font-extrabold rounded">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 font-mono">{u.username}</p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          {u.role === 'ADMIN' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-orange-50 text-[#C83A0F] border border-orange-200">
                              <ShieldAlert className="w-3 h-3" />
                              <span>ADMIN</span>
                            </span>
                          ) : u.role === 'MANAGER' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <ShieldCheck className="w-3 h-3 text-indigo-600" />
                              <span>MANAGER</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                              <Eye className="w-3 h-3" />
                              <span>GUEST</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {u.isActive !== false ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                              <span>Deactivated</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          {u.mustChangePassword ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              <KeyRound className="w-3 h-3 text-amber-700" />
                              <span>Must Change</span>
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">Standard</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                          {u.lastLoginAt ? (
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              <span>{format(new Date(u.lastLoginAt), 'dd MMM yyyy, HH:mm')}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">Never logged in</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                          {u.createdAt ? format(new Date(u.createdAt), 'dd MMM yyyy') : '—'}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {/* Change Role Button */}
                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setSelectedRole(u.role);
                                setIsRoleModalOpen(true);
                              }}
                              disabled={isSelf}
                              className={cn(
                                "p-2 rounded-xl text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors",
                                isSelf && "opacity-40 cursor-not-allowed hover:bg-transparent"
                              )}
                              title={isSelf ? "You cannot change your own role" : "Modify Role"}
                            >
                              <Shield className="w-3.5 h-3.5" />
                            </button>

                            {/* Reset Password Button */}
                            <button
                              onClick={() => {
                                setSelectedUser(u);
                                setIsResetPasswordModalOpen(true);
                              }}
                              className="p-2 rounded-xl text-amber-700 hover:bg-amber-50 border border-amber-200 transition-colors"
                              title="Reset Password & Issue Temporary Key"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>

                            {/* Toggle Active / Deactivate Button */}
                            <button
                              id={`toggle-user-status-btn-${u.id}`}
                              onClick={() => {
                                setSelectedUser(u);
                                setIsStatusConfirmModalOpen(true);
                              }}
                              disabled={isSelf && u.isActive !== false}
                              className={cn(
                                "p-2 rounded-xl border transition-colors",
                                u.isActive !== false 
                                  ? "text-slate-600 hover:bg-slate-100 border-slate-200" 
                                  : "text-emerald-700 hover:bg-emerald-50 border-emerald-200",
                                isSelf && "opacity-40 cursor-not-allowed hover:bg-transparent"
                              )}
                              title={isSelf ? "You cannot deactivate yourself" : (u.isActive !== false ? "Deactivate Account" : "Activate Account")}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete User Account Button */}
                            <button
                              id={`delete-user-btn-${u.id}`}
                              onClick={() => {
                                setSelectedUser(u);
                                setIsDeleteModalOpen(true);
                              }}
                              disabled={isSelf}
                              className={cn(
                                "p-2 rounded-xl text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors",
                                isSelf && "opacity-40 cursor-not-allowed hover:bg-transparent"
                              )}
                              title={isSelf ? "You cannot delete your own account" : "Permanently Delete User Account"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Security Audit Trail View */
        <div className="bg-white rounded-3xl border border-amber-900/10 shadow-sm overflow-hidden p-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-heading font-extrabold text-[#1E1B4B]">Immutable Security Audit Trail</h2>
              <p className="text-xs text-slate-500">Chronological log of authentication attempts, role modifications, and credentials events.</p>
            </div>
            <button
              onClick={fetchAuditLogs}
              disabled={logsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", logsLoading && "animate-spin text-[#E54818]")} />
              <span>Refresh Log</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] text-slate-500 font-extrabold uppercase tracking-wider border-b border-slate-200/80">
                  <th className="py-3 px-4 rounded-l-xl">Timestamp</th>
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Target User</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4 text-right rounded-r-xl">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      {logsLoading ? 'Fetching security audit records...' : 'No audit records recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => {
                    let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
                    if (log.eventType === 'LOGIN_SUCCESS') badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                    else if (log.eventType === 'LOGIN_FAILURE') badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
                    else if (log.eventType === 'USER_CREATED') badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
                    else if (log.eventType === 'USER_DELETED') badgeColor = 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold';
                    else if (log.eventType === 'USER_DEACTIVATED') badgeColor = 'bg-slate-100 text-slate-700 border-slate-300';
                    else if (log.eventType === 'USER_ACTIVATED') badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
                    else if (log.eventType === 'ROLE_CHANGED') badgeColor = 'bg-purple-50 text-purple-700 border-purple-200';
                    else if (log.eventType === 'PASSWORD_RESET') badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                    else if (log.eventType === 'PASSWORD_CHANGED') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {log.createdAt ? format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm:ss') : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn("inline-block px-2.5 py-0.5 rounded-md text-[10px] font-bold border", badgeColor)}>
                            {log.eventType}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-[#1E1B4B]">
                          {log.actorUsername || 'System / Unauthenticated'}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">
                          {log.targetUsername || '—'}
                        </td>
                        <td className="py-3 px-4 text-slate-600 text-[11px] max-w-xs truncate" title={log.details}>
                          {log.details || '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400 text-[10px]">
                          {log.ipAddress || '127.0.0.1'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE USER MODAL */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl border border-amber-900/15"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-orange-50 text-[#E54818] rounded-xl">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-heading font-extrabold text-[#1E1B4B] text-base">Create User Account</h3>
                    <p className="text-[11px] text-slate-500">Generates a secure temporary password automatically</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-[#1E1B4B] uppercase tracking-wider mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Kwame Mensah"
                    value={fullNameInput}
                    onChange={(e) => setFullNameInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#1E1B4B] uppercase tracking-wider mb-1.5">
                    Username / Email *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. kwame.mensah@sakainventory"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-[#1E1B4B] uppercase tracking-wider mb-1.5">
                    Role & Permissions *
                  </label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {(['ADMIN', 'MANAGER', 'GUEST'] as UserRole[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSelectedRole(r)}
                        className={cn(
                          "py-2.5 px-2 rounded-xl text-xs font-bold border transition-all text-center flex flex-col items-center gap-1",
                          selectedRole === r
                            ? "bg-[#1E1B4B] text-white border-[#1E1B4B] shadow-sm"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                        )}
                      >
                        {r === 'ADMIN' && <ShieldAlert className="w-3.5 h-3.5 text-orange-400" />}
                        {r === 'MANAGER' && <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />}
                        {r === 'GUEST' && <Eye className="w-3.5 h-3.5 text-blue-400" />}
                        <span className="text-[11px] truncate">{r === 'GUEST' ? 'GUEST (VIEWER)' : r}</span>
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 leading-snug">
                    {selectedRole === 'ADMIN' && (
                      <p><strong className="text-orange-700">Admin:</strong> Super Administrator with full governance — can manage users, assign roles, approve POs, alter inventory, and audit system logs.</p>
                    )}
                    {selectedRole === 'MANAGER' && (
                      <p><strong className="text-indigo-700">Manager:</strong> All administrative operational rights (full Inventory CRUD, Stock Movements, POs, Categories, Reports, and Logs) but <strong>cannot create or manage users</strong>.</p>
                    )}
                    {(selectedRole === 'GUEST' || selectedRole === 'VIEWER') && (
                      <p><strong className="text-blue-700">Guest (Viewer):</strong> Read-only access to view live stock levels, track movements, and export executive reports.</p>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Security & Initial Authentication</span>
                  </p>
                  <p className="text-amber-800/90 leading-relaxed">
                    A cryptographically random temporary password will be created. The user will be required to change this password on their first login.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-[#E54818] text-white rounded-xl text-xs font-bold hover:bg-[#C83A0F] shadow-sm disabled:opacity-60 transition-all"
                  >
                    {isSubmitting ? 'Creating User...' : 'Create Account'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ONE-TIME TEMPORARY PASSWORD MODAL */}
      <AnimatePresence>
        {tempPasswordModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/50 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-amber-900/15"
            >
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h3 className="font-heading font-extrabold text-[#1E1B4B] text-lg">
                  {tempPasswordModal.isReset ? 'Password Reset Successfully' : 'User Created Successfully'}
                </h3>
                <p className="text-xs text-slate-500">
                  Provide this temporary password to <span className="font-bold text-[#1E1B4B]">{tempPasswordModal.fullName}</span> ({tempPasswordModal.username}).
                </p>
              </div>

              <div className="p-4 bg-slate-900 rounded-2xl text-white space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>TEMPORARY PASSWORD</span>
                  <span className="text-amber-400 font-bold">SHOWN ONCE</span>
                </div>
                <div className="flex items-center justify-between gap-3 bg-black/40 p-3 rounded-xl border border-white/10 font-mono text-sm tracking-wider text-emerald-300 select-all">
                  <span className="font-bold">{tempPasswordModal.temporaryPassword}</span>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="p-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors shrink-0"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p>
                  This plaintext password is never stored or returned again. The user will be automatically forced to change their password when they sign in.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setTempPasswordModal(prev => ({ ...prev, isOpen: false }))}
                className="w-full py-3 bg-[#1E1B4B] text-white rounded-xl text-xs font-bold hover:bg-purple-950 transition-colors"
              >
                I have saved / transferred this temporary password
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* CHANGE ROLE MODAL */}
      <AnimatePresence>
        {isRoleModalOpen && selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl border border-amber-900/15"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-purple-50 text-purple-800 rounded-xl">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-heading font-extrabold text-[#1E1B4B] text-base">Modify User Role</h3>
                    <p className="text-[11px] text-slate-500">For user: {selectedUser.fullName}</p>
                  </div>
                </div>
                <button onClick={() => setIsRoleModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUpdateRole} className="space-y-4">
                <div className="space-y-2">
                  {(['ADMIN', 'MANAGER', 'GUEST'] as UserRole[]).map((r) => (
                    <label
                      key={r}
                      onClick={() => setSelectedRole(r)}
                      className={cn(
                        "flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all",
                        selectedRole === r
                          ? "bg-purple-50/60 border-purple-600 ring-2 ring-purple-600/20"
                          : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      <input
                        type="radio"
                        name="role"
                        checked={selectedRole === r || (r === 'GUEST' && selectedRole === 'VIEWER')}
                        onChange={() => setSelectedRole(r)}
                        className="mt-1 text-[#E54818] focus:ring-[#E54818]"
                      />
                      <div className="text-xs">
                        <p className="font-bold text-[#1E1B4B]">{r === 'GUEST' ? 'GUEST (VIEWER)' : r === 'MANAGER' ? 'MANAGER (OPERATIONS)' : r}</p>
                        <p className="text-slate-500 text-[11px] mt-0.5 leading-snug">
                          {r === 'ADMIN' && 'Full administrator governance. Can manage users, create accounts, alter roles, approve purchase orders, and audit security.'}
                          {r === 'MANAGER' && 'Operations Manager. All admin operational rights (full Inventory CRUD, Stock Movements, POs, Categories, Reports, and Logs) but restricted from user management.'}
                          {r === 'GUEST' && 'Read-only access. Can inspect inventory levels, stock movements, and export executive PDF reports.'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsRoleModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-[#1E1B4B] text-white rounded-xl text-xs font-bold hover:bg-purple-950 transition-colors"
                  >
                    {isSubmitting ? 'Updating...' : 'Save Role Change'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* RESET PASSWORD CONFIRMATION MODAL */}
      <AnimatePresence>
        {isResetPasswordModalOpen && selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-amber-900/15"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto">
                <KeyRound className="w-6 h-6" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="font-heading font-extrabold text-[#1E1B4B] text-lg">Reset User Password?</h3>
                <p className="text-xs text-slate-500">
                  This will generate a new temporary password for <span className="font-bold text-[#1E1B4B]">{selectedUser.fullName}</span> ({selectedUser.username}) and invalidate all current active sessions.
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600">
                The user will be required to change this new temporary password immediately upon their next login.
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsResetPasswordModalOpen(false)}
                  className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={isSubmitting}
                  className="w-1/2 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors"
                >
                  {isSubmitting ? 'Resetting...' : 'Confirm Reset'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* STATUS TOGGLE CONFIRMATION MODAL */}
      <AnimatePresence>
        {isStatusConfirmModalOpen && selectedUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-amber-900/15"
            >
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center mx-auto",
                selectedUser.isActive !== false ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"
              )}>
                {selectedUser.isActive !== false ? <UserX className="w-6 h-6" /> : <UserCheck className="w-6 h-6" />}
              </div>

              <div className="text-center space-y-1">
                <h3 className="font-heading font-extrabold text-[#1E1B4B] text-lg">
                  {selectedUser.isActive !== false ? 'Deactivate User Account?' : 'Re-activate User Account?'}
                </h3>
                <p className="text-xs text-slate-500">
                  Target: <span className="font-bold text-[#1E1B4B]">{selectedUser.fullName}</span> ({selectedUser.username})
                </p>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600">
                {selectedUser.isActive !== false 
                  ? 'Deactivating this account will immediately revoke all active JWT tokens and prevent any login attempts. Historical stock movements and audit records referencing this user remain intact.'
                  : 'Re-activating this account will allow the user to sign in with their existing credentials.'}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsStatusConfirmModalOpen(false)}
                  className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={isSubmitting}
                  className={cn(
                    "w-1/2 py-2.5 text-white rounded-xl text-xs font-bold transition-colors",
                    selectedUser.isActive !== false ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"
                  )}
                >
                  {isSubmitting ? 'Updating...' : (selectedUser.isActive !== false ? 'Deactivate' : 'Activate')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* PERMANENT DELETE USER CONFIRMATION MODAL */}
      <AnimatePresence>
        {isDeleteModalOpen && selectedUser && (
          <div id="delete-user-modal-backdrop" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-purple-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-rose-200"
            >
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto shadow-inner">
                <Trash2 className="w-6 h-6" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="font-heading font-extrabold text-[#1E1B4B] text-lg">
                  Delete User Account?
                </h3>
                <p className="text-xs text-slate-500">
                  Target: <span className="font-bold text-[#1E1B4B]">{selectedUser.fullName}</span> ({selectedUser.username})
                </p>
                <div className="pt-1">
                  <span className={cn(
                    "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold",
                    selectedUser.role === 'ADMIN' ? "bg-orange-100 text-orange-800" :
                    selectedUser.role === 'MANAGER' ? "bg-indigo-100 text-indigo-800" : "bg-blue-100 text-blue-800"
                  )}>
                    Role: {selectedUser.role}
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-[11px] text-rose-900 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-rose-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>Permanent Action Warning</span>
                </div>
                <p className="leading-relaxed text-rose-700">
                  This will permanently delete the user account and revoke all credentials. Historical stock movements and audit records referencing this user will remain preserved for accounting compliance.
                </p>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  id="cancel-delete-user-btn"
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold text-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="confirm-delete-user-btn"
                  type="button"
                  onClick={handleDeleteUser}
                  disabled={isSubmitting}
                  className="w-1/2 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Deleting...' : 'Delete Account'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
