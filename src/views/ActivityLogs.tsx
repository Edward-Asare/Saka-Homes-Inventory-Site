import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, 
  Search, 
  Filter, 
  RefreshCw, 
  Download, 
  Package, 
  ArrowLeftRight, 
  ShoppingCart, 
  Tags, 
  Users, 
  ShieldCheck, 
  Clock, 
  User, 
  Calendar, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight,
  ExternalLink,
  Info,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  Activity,
  AlertCircle,
  Eye,
  Trash2,
  Database,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ActivityLog, ActivityModule, ActivityEventType, AppUser } from '../types';
import { activityLogService, ActivityStatsResponse, ActivityRetentionInfo } from '../services/dataService';
import { cn } from '../lib/utils';
import { format, formatDistanceToNow } from 'date-fns';

interface ActivityLogsProps {
  currentUser: AppUser;
  onAccessDenied?: (actionName: string) => void;
}

export default function ActivityLogs({ currentUser, onAccessDenied }: ActivityLogsProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<ActivityStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('ALL');
  const [selectedActor, setSelectedActor] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [selectedLogForModal, setSelectedLogForModal] = useState<ActivityLog | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);
  const [retentionInfo, setRetentionInfo] = useState<ActivityRetentionInfo | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState<string | null>(null);
  const pageSize = 25;

  const fetchRetentionInfo = async () => {
    try {
      setRetentionLoading(true);
      const info = await activityLogService.getRetentionInfo();
      setRetentionInfo(info);
    } catch (err: any) {
      console.error('Error fetching retention info:', err);
    } finally {
      setRetentionLoading(false);
    }
  };

  const handleManualPurge = async (days = 90) => {
    if (currentUser.role !== 'ADMIN') {
      onAccessDenied?.('purge historical activity logs');
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete activity & security logs older than ${days} days? This action cannot be reversed.`)) {
      return;
    }

    try {
      setPurging(true);
      setPurgeFeedback(null);
      const res = await activityLogService.cleanupOldLogs(days);
      setPurgeFeedback(`Purge complete: Deleted ${res.activityLogsDeleted} activity logs and ${res.securityLogsDeleted} security logs.`);
      fetchLogs(1);
      fetchStats();
      fetchRetentionInfo();
    } catch (err: any) {
      setPurgeFeedback(`Purge error: ${err.message || 'Failed to execute cleanup'}`);
    } finally {
      setPurging(false);
    }
  };

  const fetchLogs = async (page = currentPage) => {
    try {
      setLoading(true);
      const offset = (page - 1) * pageSize;
      const res = await activityLogService.getLogs({
        module: selectedModule,
        actorUsername: selectedActor,
        search: searchQuery,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit: pageSize,
        offset
      });
      setLogs(res.logs || []);
      setTotalCount(res.pagination?.total || 0);
    } catch (err: any) {
      console.error('Error loading activity logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      setStatsLoading(true);
      const res = await activityLogService.getStats();
      setStats(res);
    } catch (err: any) {
      console.error('Error loading activity stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
    setCurrentPage(1);
  }, [selectedModule, selectedActor, startDate, endDate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs(1);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchStats();
  }, []);

  // Periodic polling if auto-refresh is active
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(currentPage);
      fetchStats();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, currentPage, selectedModule, selectedActor, startDate, endDate, searchQuery]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    fetchLogs(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const exportToCSV = () => {
    if (logs.length === 0) return;
    const headers = ['Timestamp', 'Module', 'Event Type', 'User (Actor)', 'Role', 'Target Entity', 'Action Summary', 'Details', 'IP Address'];
    const rows = logs.map(l => [
      `"${new Date(l.createdAt).toISOString()}"`,
      `"${l.module}"`,
      `"${l.eventType}"`,
      `"${l.actorUsername} (${l.actorName || ''})"`,
      `"${l.actorRole}"`,
      `"${(l.targetName || '').replace(/"/g, '""')}"`,
      `"${(l.actionSummary || '').replace(/"/g, '""')}"`,
      `"${(l.details || '').replace(/"/g, '""')}"`,
      `"${l.ipAddress || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `saka_homes_activity_log_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getModuleConfig = (module: ActivityModule) => {
    switch (module) {
      case 'INVENTORY':
        return {
          icon: Package,
          label: 'Inventory',
          badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dotColor: 'bg-emerald-500',
          borderAccent: 'border-l-emerald-500'
        };
      case 'STOCK_MOVEMENTS':
        return {
          icon: ArrowLeftRight,
          label: 'Stock Movements',
          badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
          dotColor: 'bg-blue-500',
          borderAccent: 'border-l-blue-500'
        };
      case 'PURCHASE_ORDERS':
        return {
          icon: ShoppingCart,
          label: 'Purchase Orders',
          badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
          dotColor: 'bg-amber-500',
          borderAccent: 'border-l-amber-500'
        };
      case 'CATEGORIES':
        return {
          icon: Tags,
          label: 'Categories',
          badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
          dotColor: 'bg-purple-500',
          borderAccent: 'border-l-purple-500'
        };
      case 'USER_MANAGEMENT':
        return {
          icon: Users,
          label: 'User Management',
          badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          dotColor: 'bg-indigo-500',
          borderAccent: 'border-l-indigo-500'
        };
      case 'AUTHENTICATION':
        return {
          icon: ShieldCheck,
          label: 'Authentication',
          badgeBg: 'bg-slate-100 text-slate-700 border-slate-300',
          dotColor: 'bg-slate-500',
          borderAccent: 'border-l-slate-500'
        };
      default:
        return {
          icon: Activity,
          label: module,
          badgeBg: 'bg-slate-50 text-slate-600 border-slate-200',
          dotColor: 'bg-slate-400',
          borderAccent: 'border-l-slate-400'
        };
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-amber-900/10 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 bg-[#E54818]/10 text-[#E54818] rounded-2xl">
                <History className="w-6 h-6" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-heading font-semibold text-[#1E1B4B]">
                Activity Logs & Audit Trail
              </h1>
            </div>
            <p className="text-slate-500 text-sm sm:text-sm pl-11">
              Comprehensive chronological log recording all inventory changes, stock dispatches, PO fulfillments, and user account actions with user attribution.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pl-11 sm:pl-0">
            <button
              onClick={() => {
                fetchRetentionInfo();
                setRetentionModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              title="View 90-Day Automatic Retention Policy"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>90-Day Auto-Retention</span>
            </button>

            <button
              onClick={() => {
                fetchLogs(currentPage);
                fetchStats();
              }}
              disabled={loading}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-[#1E1B4B] rounded-xl text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              title="Refresh Logs"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin text-[#E54818]")} />
              <span>Refresh</span>
            </button>

            <button
              onClick={exportToCSV}
              disabled={logs.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-[#1E1B4B] text-white hover:bg-purple-950 rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
              title="Export Log Records as CSV"
            >
              <Download className="w-3.5 h-3.5 text-orange-400" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Top Metric Highlight Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 pt-4 border-t border-slate-100">
          <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-amber-900/10 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
              <span>Total Recorded Events</span>
              <Activity className="w-4 h-4 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-[#1E1B4B]">
              {stats?.totalLogs?.toLocaleString() ?? totalCount}
            </p>
            <p className="text-[11px] text-slate-500 font-medium">All logged user operations</p>
          </div>

          <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-amber-900/10 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
              <span>Last 24 Hours</span>
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {stats?.actionsLast24h?.toLocaleString() ?? 0}
            </p>
            <p className="text-[11px] text-slate-500 font-medium">Recent operational actions</p>
          </div>

          <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-amber-900/10 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
              <span>Most Active User</span>
              <User className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-base font-bold text-[#1E1B4B] truncate">
              {stats?.topActors?.[0]?.actor_username || 'Admin'}
            </p>
            <p className="text-[11px] text-slate-500 font-medium truncate">
              {stats?.topActors?.[0] ? `${stats.topActors[0].actions_count} operations` : 'Active'}
            </p>
          </div>

          <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-amber-900/10 space-y-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold">
              <span>Primary Activity</span>
              <Layers className="w-4 h-4 text-purple-500" />
            </div>
            <p className="text-base font-bold text-purple-700 truncate">
              {stats?.moduleBreakdown?.[0]?.module?.replace('_', ' ') || 'INVENTORY'}
            </p>
            <p className="text-[11px] text-slate-500 font-medium truncate">
              {stats?.moduleBreakdown?.[0] ? `${stats.moduleBreakdown[0].count} events` : 'Tracking'}
            </p>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-5 rounded-2xl border border-amber-900/10 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by action, item code, material name, PO#, user username..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-[#1E1B4B] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#E54818] transition-all placeholder:text-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                Clear
              </button>
            )}
          </div>

          {/* Module Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-slate-500 shrink-0">Module:</label>
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#1E1B4B] focus:outline-none focus:ring-2 focus:ring-[#E54818]"
            >
              <option value="ALL">All Modules</option>
              <option value="INVENTORY">Inventory Items</option>
              <option value="STOCK_MOVEMENTS">Stock Movements & Dispatches</option>
              <option value="PURCHASE_ORDERS">Purchase Orders</option>
              <option value="CATEGORIES">Categories</option>
              <option value="USER_MANAGEMENT">User Management</option>
              <option value="AUTHENTICATION">Sign-In / Auth</option>
            </select>
          </div>

          {/* Actor Username Filter */}
          {stats?.topActors && stats.topActors.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold text-slate-500 shrink-0">Actor:</label>
              <select
                value={selectedActor}
                onChange={(e) => setSelectedActor(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-[#1E1B4B] focus:outline-none focus:ring-2 focus:ring-[#E54818]"
              >
                <option value="ALL">All Users</option>
                {stats.topActors.map(a => (
                  <option key={a.actor_username} value={a.actor_username}>
                    {a.actor_username} ({a.actor_role})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date range */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#1E1B4B] focus:outline-none"
                title="From date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-xs font-semibold text-[#1E1B4B] focus:outline-none"
                title="To date"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-[10px] text-rose-500 font-bold hover:underline ml-1"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Activity Log Feed */}
      <div className="bg-white rounded-2xl border border-amber-900/10 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-[#E54818]" />
            <p className="text-xs font-bold text-slate-400">Loading audit activity logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500">
              <History className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-[#1E1B4B]">No activity events found</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              {searchQuery || selectedModule !== 'ALL' || selectedActor !== 'ALL' || startDate || endDate
                ? 'Try adjusting or clearing your filters to see more events.'
                : 'As administrators and supervisors create, update, or dispatch inventory, all events will appear here in real-time.'}
            </p>
            {(searchQuery || selectedModule !== 'ALL' || selectedActor !== 'ALL' || startDate || endDate) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedModule('ALL');
                  setSelectedActor('ALL');
                  setStartDate('');
                  setEndDate('');
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#1E1B4B] rounded-xl text-xs font-bold transition-all"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {logs.map((log) => {
              const modConfig = getModuleConfig(log.module);
              const ModIcon = modConfig.icon;
              const isExpanded = expandedLogId === log.id;

              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    "p-5 hover:bg-slate-50/80 transition-colors border-l-4",
                    modConfig.borderAccent
                  )}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3.5">
                    {/* Left Column: Icon + Description */}
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div className={cn("p-2.5 rounded-2xl border shrink-0 mt-0.5", modConfig.badgeBg)}>
                        <ModIcon className="w-4 h-4" />
                      </div>

                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wider", modConfig.badgeBg)}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", modConfig.dotColor)} />
                            {modConfig.label}
                          </span>

                          <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                            {log.eventType.replace(/_/g, ' ')}
                          </span>

                          {log.targetName && (
                            <span className="text-[11px] font-bold text-[#1E1B4B] bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-md truncate max-w-xs" title={log.targetName}>
                              Target: {log.targetName}
                            </span>
                          )}
                        </div>

                        <p className="text-xs sm:text-sm font-bold text-[#1E1B4B] leading-snug">
                          {log.actionSummary}
                        </p>

                        {log.details && (
                          <p className="text-xs text-slate-500 font-medium whitespace-pre-line leading-relaxed">
                            {log.details}
                          </p>
                        )}

                        {/* Metadata / Diff Dropdown if exists */}
                        {log.metadata && (
                          <div className="pt-1">
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600 hover:text-orange-700"
                            >
                              <span>{isExpanded ? 'Hide audit metadata diff' : 'View audit metadata diff'}</span>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-xl text-[11px] font-mono overflow-x-auto shadow-inner space-y-2"
                                >
                                  {log.metadata.changes && Array.isArray(log.metadata.changes) && (
                                    <div className="space-y-1 pb-2 border-b border-slate-800">
                                      <p className="text-orange-400 font-bold uppercase tracking-wider text-[10px]">Field Modifications:</p>
                                      <ul className="space-y-0.5 text-emerald-300">
                                        {log.metadata.changes.map((c: string, idx: number) => (
                                          <li key={idx}>• {c}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  <div className="space-y-1">
                                    <p className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Full Event Metadata JSON:</p>
                                    <pre className="text-slate-300 text-[10px] leading-tight">
                                      {JSON.stringify(log.metadata, null, 2)}
                                    </pre>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Column: User Attribution + Timestamp */}
                    <div className="flex md:flex-col items-center md:items-end justify-between md:justify-start gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-[#E54818] to-purple-600 flex items-center justify-center text-white font-bold text-[10px] uppercase shadow-2xs">
                          {log.actorUsername[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="text-left md:text-right">
                          <p className="text-xs font-semibold text-[#1E1B4B]">{log.actorUsername}</p>
                          <span className={cn(
                            "inline-block px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase",
                            log.actorRole === 'ADMIN' ? "text-orange-600 bg-orange-50 font-bold" : "text-blue-600 bg-blue-50"
                          )}>
                            {log.actorRole}
                          </span>
                        </div>
                      </div>

                      <div className="text-left md:text-right space-y-0.5">
                        <p className="text-[11px] font-bold text-slate-600" title={new Date(log.createdAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium">
                          {format(new Date(log.createdAt), 'dd-MMM-yyyy HH:mm:ss')}
                        </p>
                        {log.ipAddress && (
                          <p className="text-[9px] text-slate-400 font-mono">
                            IP: {log.ipAddress}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Pagination Footer */}
        {totalCount > pageSize && (
          <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <div className="text-xs text-slate-500 font-medium">
              Showing <span className="font-bold text-[#1E1B4B]">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-bold text-[#1E1B4B]">{Math.min(currentPage * pageSize, totalCount)}</span> of <span className="font-bold text-[#1E1B4B]">{totalCount}</span> events
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 text-xs font-semibold text-[#1E1B4B]">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Retention Policy Information & Management Modal */}
      <AnimatePresence>
        {retentionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-slate-200 space-y-6 relative"
            >
              <button
                onClick={() => {
                  setRetentionModalOpen(false);
                  setPurgeFeedback(null);
                }}
                className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-heading font-bold text-[#1E1B4B]">
                    90-Day Automated Retention
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Automated background log lifecycle & storage hygiene
                  </p>
                </div>
              </div>

              {/* Policy Highlights */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Retention Window:</span>
                  <span className="font-semibold text-[#1E1B4B] px-2 py-0.5 rounded bg-white border border-slate-200">
                    90 Days (Active)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Automatic Cleanup Schedule:</span>
                  <span className="font-semibold text-emerald-700">
                    Every 24 Hours & Server Startup
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/60">
                  <span className="text-slate-500 font-medium">Target Tables:</span>
                  <span className="font-mono text-[11px] text-slate-700">
                    activity_logs & security_audit_logs
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-medium">Eligible for Purge (&gt;90 days):</span>
                  <span className="font-bold text-slate-900">
                    {retentionLoading ? 'Checking...' : `${(retentionInfo?.activityLogsEligible ?? 0) + (retentionInfo?.securityLogsEligible ?? 0)} records`}
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-600 leading-relaxed bg-amber-50/70 p-3.5 rounded-xl border border-amber-200/60">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    Entries older than 90 calendar days are automatically pruned from the database on a daily schedule. You can export complete CSV archives anytime before purging.
                  </p>
                </div>
              </div>

              {purgeFeedback && (
                <div className={cn(
                  "p-3 rounded-xl text-xs font-bold flex items-center gap-2",
                  purgeFeedback.startsWith('Purge complete') ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"
                )}>
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{purgeFeedback}</span>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  onClick={exportToCSV}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-orange-500" />
                  <span>Backup CSV</span>
                </button>

                {currentUser.role === 'ADMIN' && (
                  <button
                    onClick={() => handleManualPurge(90)}
                    disabled={purging}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className={cn("w-3.5 h-3.5", purging && "animate-spin")} />
                    <span>{purging ? 'Purging Old Logs...' : 'Purge Logs >90d Now'}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
