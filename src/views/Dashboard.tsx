import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  ArrowRight, 
  ShieldCheck, 
  MessageSquare 
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import { InventoryItem, UserRole } from '../types';
import { inventoryService } from '../services/dataService';
import { cn } from '../lib/utils';
import SakaHomesLogo from '../components/SakaHomesLogo';

interface DashboardProps {
  searchQuery: string;
  setActiveView: (view: any) => void;
  userRole?: UserRole;
  onAccessDenied?: (actionName?: string) => void;
}

export default function Dashboard({ searchQuery, setActiveView, userRole = 'ADMIN', onAccessDenied }: DashboardProps) {
  const isViewer = userRole !== 'ADMIN' && userRole !== 'MANAGER';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = inventoryService.subscribe((newItems) => {
      setItems(newItems);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const filteredItems = items.filter(item => 
    item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.itemCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const stats = [
    { 
      label: 'Total Active SKUs', 
      value: filteredItems.length, 
      description: 'Tracked across all categories' 
    },
    { 
      label: 'In Stock & Ready', 
      value: filteredItems.filter(i => i.status === 'IN STOCK').length, 
      description: 'Sufficient site supply' 
    },
    { 
      label: 'Low Stock Alerts', 
      value: filteredItems.filter(i => i.status === 'LOW STOCK').length, 
      description: 'At or below min threshold' 
    },
    { 
      label: 'Out of Stock', 
      value: filteredItems.filter(i => i.status === 'OUT OF STOCK').length, 
      description: 'Zero stock available' 
    }
  ];

  const categoryData = Object.entries(
    filteredItems.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }));

  const statusData = [
    { name: 'In Stock', value: filteredItems.filter(i => i.status === 'IN STOCK').length, color: '#10B981' },
    { name: 'Low Stock', value: filteredItems.filter(i => i.status === 'LOW STOCK').length, color: '#F59E0B' },
    { name: 'Out of Stock', value: filteredItems.filter(i => i.status === 'OUT OF STOCK').length, color: '#F43F5E' },
  ];

  const categoryColors = ['#2B1A70', '#E54818', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0284C7'];

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-44 bg-purple-950/20 rounded-3xl border border-purple-900/10" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-slate-200/60 rounded-3xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-slate-200/60 rounded-3xl" />
          <div className="h-96 bg-slate-200/60 rounded-3xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Executive Welcome Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#1E1B4B] via-[#2B1A70] to-[#120B29] rounded-3xl p-8 text-white shadow-xl shadow-purple-950/10 border border-purple-900/50">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-[#E54818]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-8 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="bg-white/10 backdrop-blur-md px-3.5 py-1.5 rounded-2xl border border-white/20 inline-block">
              <SakaHomesLogo variant="white" size="md" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-heading font-extrabold tracking-tight text-white">
              Saka Homes Material & Site Operations
            </h1>
          </div>
        </div>
      </div>

      {/* Modern KPI Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat, i) => {
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all group hover:border-slate-300"
            >
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{stat.label}</p>
                <p className="text-3xl font-heading font-black text-slate-900 mt-1">{stat.value}</p>
                <p className="text-[11px] text-slate-400 mt-1">{stat.description}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Analytics & Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category Breakdown Bar Chart */}
        <div className="lg:col-span-2 bg-white p-7 rounded-3xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-heading font-extrabold text-slate-900">Category Stock Breakdown</h2>
              <p className="text-xs text-slate-500">Material distribution across active store categories</p>
            </div>
            <button 
              onClick={() => setActiveView('categories')}
              className="inline-flex items-center gap-1 text-xs font-bold text-[#E54818] hover:text-[#C83A0F] transition-colors"
            >
              <span>All Categories</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }}
                  dy={8}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748B', fontSize: 11, fontWeight: 600 }}
                />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ 
                    backgroundColor: '#0F172A',
                    color: '#FFFFFF',
                    borderRadius: '16px', 
                    border: 'none', 
                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.2)',
                    padding: '12px 16px',
                    fontSize: '12px',
                    fontWeight: 600
                  }}
                  itemStyle={{ color: '#38BDF8' }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={36}>
                  {categoryData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={categoryColors[index % categoryColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Inventory Health Pie Chart */}
        <div className="bg-white p-7 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-heading font-extrabold text-slate-900">Stock Health Index</h2>
                <p className="text-xs text-slate-500">Ratio of stock availability status</p>
              </div>
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            </div>

            <div className="h-[200px] flex items-center justify-center relative my-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={6}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      color: '#FFF',
                      borderRadius: '12px',
                      border: 'none',
                      fontSize: '11px',
                      fontWeight: 600
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total SKUs</span>
                <span className="text-2xl font-heading font-black text-slate-900">{filteredItems.length}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            {statusData.map((status) => (
              <div key={status.name} className="flex items-center justify-between text-xs font-semibold">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                  <span className="text-slate-600">{status.name}</span>
                </div>
                <span className="text-slate-900 font-bold">{status.value} items</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Critical Items Alert Board */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-heading font-extrabold text-slate-900">Critical Stock Attention Needed</h2>
              <p className="text-xs text-slate-500">Items reaching or exceeding minimum safety thresholds</p>
            </div>
          </div>
          <button 
            onClick={() => setActiveView('inventory')}
            className="text-xs font-bold text-[#E54818] hover:text-[#C83A0F] bg-orange-50/80 hover:bg-orange-100/80 px-3.5 py-2 rounded-xl border border-orange-200/80 transition-all"
          >
            Manage Inventory
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-6 py-3.5">Material & Code</th>
                <th className="px-6 py-3.5">Category</th>
                <th className="px-6 py-3.5">Stock Meter</th>
                <th className="px-6 py-3.5">Supplier</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium">
              {filteredItems.filter(i => i.status !== 'IN STOCK').slice(0, 5).map((item) => {
                const currStock = item.currentStock !== undefined ? item.currentStock : item.reorderQty;
                const pct = Math.min(100, Math.round((currStock / Math.max(1, item.minStockLevel * 2)) * 100));

                return (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-slate-900">{item.itemName}</p>
                        <p className="text-[11px] font-mono text-slate-400 mt-0.5">{item.itemCode}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-slate-100 rounded-lg text-[11px] font-semibold text-slate-600">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 w-48">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="font-bold text-slate-800">{currStock} {item.unitOfMeasure}</span>
                          <span className="text-slate-400">Min: {item.minStockLevel}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              item.status === 'LOW STOCK' ? "bg-amber-500" : "bg-rose-500"
                            )} 
                            style={{ width: `${Math.max(8, pct)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">{item.supplier || 'N/A'}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase",
                        item.status === 'LOW STOCK' 
                          ? "bg-amber-50 text-amber-700 border border-amber-200/80" 
                          : "bg-rose-50 text-rose-700 border border-rose-200/80"
                      )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", item.status === 'LOW STOCK' ? "bg-amber-500" : "bg-rose-500")} />
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isViewer ? (
                        <button 
                          onClick={() => setActiveView('orders')}
                          className="px-3 py-1.5 bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-lg text-[11px] font-bold transition-all shadow-2xs inline-flex items-center gap-1.5"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>Order on WhatsApp</span>
                        </button>
                      ) : (
                        <button 
                          onClick={() => {
                            setActiveView('purchase-orders');
                          }}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-bold transition-all shadow-2xs"
                        >
                          Create PO
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredItems.filter(i => i.status !== 'IN STOCK').length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                    <p className="font-bold text-slate-700">Optimal Inventory Health</p>
                    <p className="text-xs text-slate-400 mt-0.5">All tracked materials are above minimum stock levels.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
