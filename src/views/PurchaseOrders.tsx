import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  ShoppingCart, 
  Clock, 
  CheckCircle, 
  Trash2,
  FileText,
  Search,
  MoreHorizontal,
  X,
  PackageCheck,
  AlertCircle,
  FileDown,
  Filter,
  Calendar as CalendarIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PurchaseOrder, InventoryItem, UserRole, AppUser } from '../types';
import { poService, inventoryService } from '../services/dataService';
import { formatCurrency, cn } from '../lib/utils';
import { exportPurchaseOrdersPDF } from '../lib/pdfExport';
import { format, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns';

type DatePreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER' | 'CUSTOM';

interface POProps {
  searchQuery: string;
  userRole?: UserRole;
  currentUser?: AppUser;
  onAccessDenied?: (actionName?: string) => void;
}

export default function PurchaseOrders({ searchQuery, userRole = 'ADMIN', currentUser, onAccessDenied }: POProps) {
  const isViewer = userRole !== 'ADMIN' && userRole !== 'MANAGER';
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Date Range Filtering State
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Form states for auto-filling
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [unitCost, setUnitCost] = useState<number | ''>('');

  useEffect(() => {
    const unsubPO = poService.subscribe((newPos) => {
      setPos(newPos);
      setLoading(false);
    });
    const unsubInv = inventoryService.subscribe((items) => {
      setInventoryItems(items);
    });
    return () => {
      unsubPO();
      unsubInv();
    };
  }, []);

  const handleSelectItem = (id: string) => {
    setSelectedItemId(id);
    if (id) {
      const item = inventoryItems.find(i => i.id === id);
      if (item) {
        setItemCode(item.itemCode || '');
        setItemName(item.itemName || '');
        setSupplier(item.supplier || '');
        setUnitCost(item.unitCost || 0);
      }
    } else {
      setItemCode('');
      setItemName('');
      setSupplier('');
      setUnitCost('');
    }
  };

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');

    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'THIS_WEEK') {
      const weekStart = startOfWeek(today, { weekStartsOn: 1 });
      setStartDate(format(weekStart, 'yyyy-MM-dd'));
      setEndDate(todayStr);
    } else if (preset === 'THIS_MONTH') {
      const monthStart = startOfMonth(today);
      setStartDate(format(monthStart, 'yyyy-MM-dd'));
      setEndDate(todayStr);
    } else if (preset === 'THIS_QUARTER') {
      const qStart = startOfQuarter(today);
      setStartDate(format(qStart, 'yyyy-MM-dd'));
      setEndDate(todayStr);
    }
  };

  const filteredPos = pos.filter(po => {
    const matchesSearch = po.poNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      po.supplier.toLowerCase().includes(searchQuery.toLowerCase());

    const poDate = po.orderDate || '';
    if (startDate && poDate < startDate) return false;
    if (endDate && poDate > endDate) return false;

    return matchesSearch;
  });

  const getDateLabel = () => {
    if (!startDate && !endDate) return 'All Time';
    if (startDate === endDate && startDate) return `Date: ${startDate}`;
    if (startDate && endDate) return `Period: ${startDate} to ${endDate}`;
    if (startDate) return `From: ${startDate}`;
    if (endDate) return `Up to: ${endDate}`;
    return 'All Time';
  };

  const handleExportCSV = () => {
    const headerTitle = `SAKA HOMES PURCHASE ORDERS LOG (${getDateLabel()})\n`;
    const headers = "PO Number,Item Code,Item Name,Supplier,Qty Ordered,Unit Cost (GHS),Total Spend (GHS),Order Date,Expected Delivery,Issued By (User Account),Status,Notes\n";
    const rows = filteredPos.map(p => 
      `"${p.poNumber}","${p.itemCode}","${p.itemName}","${p.supplier}",${p.qtyOrdered},${p.unitCost},${p.totalCost},"${p.orderDate}","${p.expectedDate || ''}","${p.createdBy || 'admin'}","${p.status}","${p.notes || ''}"`
    ).join('\n');

    const blob = new Blob([headerTitle + headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saka-homes-purchase-orders-${datePreset.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportPDF = () => {
    exportPurchaseOrdersPDF(filteredPos, getDateLabel());
  };

  const handleAddPO = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const poData = {
      poNumber: formData.get('poNumber') as string || `PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
      itemId: selectedItemId || undefined,
      itemCode: (formData.get('itemCode') as string) || itemCode,
      itemName: (formData.get('itemName') as string) || itemName,
      supplier: (formData.get('supplier') as string) || supplier,
      qtyOrdered: Number(formData.get('qtyOrdered')),
      unitCost: Number(formData.get('unitCost') || unitCost || 0),
      totalCost: Number(formData.get('qtyOrdered')) * Number(formData.get('unitCost') || unitCost || 0),
      orderDate: (formData.get('orderDate') as string) || new Date().toISOString().split('T')[0],
      expectedDate: (formData.get('expectedDate') as string) || '',
      status: (formData.get('status') as any) || 'PENDING',
      notes: (formData.get('notes') as string) || '',
      createdBy: currentUser?.username || currentUser?.fullName || 'admin',
    };

    await poService.addPO(poData);
    setIsModalOpen(false);
    // Reset selection
    setSelectedItemId('');
    setItemCode('');
    setItemName('');
    setSupplier('');
    setUnitCost('');
  };

  const handleUpdateStatus = async (id: string, status: PurchaseOrder['status']) => {
    await poService.updatePOStatus(id, status);
  };

  const handleDeletePO = async (id: string) => {
    if (userRole !== 'ADMIN') {
      if (onAccessDenied) onAccessDenied('permanently delete purchase orders (Admin access required)');
      return;
    }
    if (confirm('Delete this purchase order permanently?')) {
      try {
        await poService.deletePO(id);
      } catch (error: any) {
        alert(error?.message || "Failed to delete purchase order.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-[#64748B]">Tracker for material procurement and automatic store restocking.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-[#1E1B4B] hover:bg-[#FAF8F5] transition-all shadow-2xs"
            title="Export CSV spreadsheet"
          >
            <FileDown className="w-4 h-4 text-[#E54818]" />
            <span>Export CSV</span>
          </button>
          <button 
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-3.5 py-2 border border-purple-200 bg-purple-50/60 rounded-xl text-xs font-bold text-[#1E1B4B] hover:bg-purple-100/60 transition-all shadow-2xs"
            title="Export formatted PDF table report"
          >
            <FileText className="w-4 h-4 text-[#2B1A70]" />
            <span>Export PDF</span>
          </button>
          <button 
            onClick={() => {
              if (isViewer) {
                onAccessDenied?.('create new purchase orders');
                return;
              }
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#E54818] text-white rounded-xl font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] transition-all text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>New Order</span>
          </button>
        </div>
      </div>

      {/* Date Filter & Preset Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[#1E1B4B]">
            <Filter className="w-4 h-4 text-[#E54818]" />
            <span>Date Scope Filter (Applies to Orders & CSV Export):</span>
          </div>
          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-2">
            {(['ALL', 'TODAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_QUARTER', 'CUSTOM'] as DatePreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetChange(preset)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-xs font-bold transition-all",
                  datePreset === preset
                    ? "bg-[#1E1B4B] text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
                )}
              >
                {preset === 'ALL' ? 'All Time' :
                 preset === 'TODAY' ? 'Today' :
                 preset === 'THIS_WEEK' ? 'This Week' :
                 preset === 'THIS_MONTH' ? 'This Month' :
                 preset === 'THIS_QUARTER' ? 'This Quarter' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Pickers */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end pt-2 border-t border-slate-100">
          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-[#E54818]" />
              From Order Date
            </label>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-3 py-2 bg-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-[#E54818]/20 border border-transparent focus:bg-white text-xs font-bold text-[#1E1B4B] transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-[#E54818]" />
              To Order Date
            </label>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-3 py-2 bg-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-[#E54818]/20 border border-transparent focus:bg-white text-xs font-bold text-[#1E1B4B] transition-all"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#1E1B4B] bg-amber-500/10 px-3 py-2 rounded-xl border border-amber-500/20 w-full text-center">
              Active Scope: {getDateLabel()} ({filteredPos.length} orders)
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-3xl border-2 border-[#E2E8F0] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1200px]">
            <thead className="bg-[#F8FAFC]">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">PO Number</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Item Details</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Supplier</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Qty</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Total Cost</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Dates</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-[#64748B] uppercase tracking-[0.1em]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {loading ? (
                <tr><td colSpan={8} className="px-6 py-20 text-center animate-pulse">Loading orders...</td></tr>
              ) : filteredPos.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-20 text-center text-[#94A3B8]">No purchase orders found.</td></tr>
              ) : filteredPos.map((po) => (
                <tr key={po.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-6 py-5 font-mono text-xs font-bold text-blue-600">
                    <div className="flex flex-col gap-1">
                      <span>{po.poNumber}</span>
                      <span className="text-[10px] font-sans font-medium text-slate-500">
                        By: <strong className="text-slate-700">{po.createdBy || 'admin'}</strong>
                      </span>
                      {po.inventoryUpdated && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md w-max">
                          <PackageCheck className="w-3 h-3" /> Restocked
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-[#1E293B]">{po.itemName}</span>
                      <span className="text-[10px] font-mono text-[#94A3B8]">{po.itemCode}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 font-medium">{po.supplier}</td>
                  <td className="px-6 py-5 font-bold text-[#1E293B]">{po.qtyOrdered}</td>
                  <td className="px-6 py-5 font-bold text-blue-600">{formatCurrency(po.totalCost)}</td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col text-[10px] gap-1">
                      <span className="flex items-center gap-1 text-[#64748B]">
                        <Clock className="w-3 h-3" /> Ordered: {po.orderDate}
                      </span>
                      <span className="flex items-center gap-1 text-blue-600 font-bold">
                        <CheckCircle className="w-3 h-3" /> Exp: {po.expectedDate}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase",
                      po.status === 'COMPLETED' ? "bg-emerald-100 text-emerald-700" :
                      po.status === 'PENDING' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                    )}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          if (isViewer) {
                            onAccessDenied?.('update purchase order status');
                            return;
                          }
                          handleUpdateStatus(po.id, po.status === 'PENDING' ? 'COMPLETED' : 'PENDING');
                        }}
                        title={po.status === 'PENDING' ? "Mark as Completed (Syncs Inventory Stock)" : "Mark as Pending"}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                          po.status === 'PENDING' 
                            ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <CheckCircle className="w-4 h-4" />
                        {po.status === 'PENDING' ? "Mark Received" : "Reopen"}
                      </button>
                      <button 
                        onClick={() => {
                          if (isViewer) {
                            onAccessDenied?.('delete purchase orders');
                            return;
                          }
                          handleDeletePO(po.id);
                        }}
                        title="Delete Order"
                        className="p-2 hover:bg-red-50 text-[#64748B] hover:text-red-600 rounded-lg transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-8 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
                <div>
                  <h2 className="text-2xl font-bold">New Purchase Order</h2>
                  <p className="text-xs text-[#64748B] mt-0.5">Orders will automatically sync stock levels to Inventory & Dashboard upon fulfillment.</p>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleAddPO} className="p-8 overflow-y-auto space-y-6">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-800">
                    <p className="font-bold">Automatic Inventory Synchronization</p>
                    <p className="mt-0.5 text-blue-700">Select an existing inventory item below or enter custom item details. Marking this PO as <strong>COMPLETED</strong> immediately increments the item's available stock in Inventory and updates the Dashboard metrics.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Select Existing Inventory Item (Optional)</label>
                  <select 
                    value={selectedItemId}
                    onChange={(e) => handleSelectItem(e.target.value)}
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-medium text-sm"
                  >
                    <option value="">-- Or enter new material details below --</option>
                    {inventoryItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.itemName} ({item.itemCode}) - Current Stock: {item.currentStock !== undefined ? item.currentStock : item.reorderQty} {item.unitOfMeasure}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">PO Number</label>
                    <input name="poNumber" required defaultValue={`PO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-mono font-bold" placeholder="e.g. PO-2026-001" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Item Code</label>
                    <input name="itemCode" required value={itemCode} onChange={(e) => setItemCode(e.target.value)} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-mono" placeholder="e.g. SKH-001" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Item Name</label>
                    <input name="itemName" required value={itemName} onChange={(e) => setItemName(e.target.value)} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold" placeholder="e.g. Portland Cement" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Supplier</label>
                    <input name="supplier" required value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" placeholder="e.g. RoofMaster Ltd" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Qty Ordered</label>
                    <input type="number" name="qtyOrdered" required className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold" placeholder="e.g. 100" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Unit Cost (GHS)</label>
                    <input type="number" step="0.01" name="unitCost" required value={unitCost} onChange={(e) => setUnitCost(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold" placeholder="e.g. 45.00" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Order Date</label>
                    <input type="date" name="orderDate" required defaultValue={new Date().toISOString().split('T')[0]} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Expected Date</label>
                    <input type="date" name="expectedDate" required defaultValue={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">Initial Order Status</label>
                  <select name="status" className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold">
                    <option value="PENDING">PENDING (Awaiting delivery)</option>
                    <option value="COMPLETED">COMPLETED (Received into inventory immediately)</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>
                
                <div className="pt-6 flex gap-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-4 border-2 border-[#E2E8F0] rounded-2xl font-bold text-[#64748B] hover:bg-[#F8FAFC]">Cancel</button>
                  <button type="submit" className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all">
                    Create PO
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
