import React, { useState, useEffect } from 'react';
import { 
  ArrowLeftRight, 
  Send, 
  Plus, 
  FileDown, 
  FileText,
  Search, 
  Trash2, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  X,
  Printer,
  Building2,
  UserCheck,
  TrendingDown,
  RefreshCw,
  Package,
  PackageX,
  Calendar as CalendarIcon,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryItem, StockMovement, UserRole, AppUser } from '../types';
import { inventoryService, stockMovementService } from '../services/dataService';
import { cn } from '../lib/utils';
import { exportStockMovementsPDF } from '../lib/pdfExport';
import { format, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns';
import NoStockModal from '../components/NoStockModal';

type DatePreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER' | 'CUSTOM';

interface StockMovementsProps {
  searchQuery: string;
  initialSelectedItemId?: string | null;
  onClearInitialSelectedItemId?: () => void;
  userRole?: UserRole;
  currentUser?: AppUser;
  onAccessDenied?: (actionName?: string) => void;
}

export default function StockMovements({ 
  searchQuery, 
  initialSelectedItemId, 
  onClearInitialSelectedItemId,
  userRole = 'ADMIN', 
  currentUser, 
  onAccessDenied 
}: StockMovementsProps) {
  const isViewer = userRole !== 'ADMIN' && userRole !== 'MANAGER';
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('ALL');

  // Date Range Filtering State
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'ISSUED_OUT' | 'RESTOCKED' | 'ADJUSTMENT'>('ISSUED_OUT');

  // Zero stock alert modal state
  const [noStockItem, setNoStockItem] = useState<InventoryItem | null>(null);
  const [isNoStockModalOpen, setIsNoStockModalOpen] = useState(false);

  // Form State
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [recipient, setRecipient] = useState<string>('');
  const [issuedBy, setIssuedBy] = useState<string>('');
  const [movementDate, setMovementDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');

  const handledInitialItemIdRef = React.useRef<string | null>(null);

  useEffect(() => {
    const unsubMovements = stockMovementService.subscribe((data) => {
      setMovements(data);
      setLoading(false);
    });
    const unsubItems = inventoryService.subscribe((data) => {
      setItems(data);
    });

    return () => {
      unsubMovements();
      unsubItems();
    };
  }, []);

  // Handle single-shot initialSelectedItemId when navigating from Inventory "Issue"
  useEffect(() => {
    if (initialSelectedItemId && items.length > 0 && handledInitialItemIdRef.current !== initialSelectedItemId) {
      const targetItem = items.find(i => i.id === initialSelectedItemId);
      if (targetItem) {
        handledInitialItemIdRef.current = initialSelectedItemId;
        const available = targetItem.currentStock !== undefined ? targetItem.currentStock : targetItem.reorderQty;
        if (available <= 0) {
          setNoStockItem(targetItem);
          setIsNoStockModalOpen(true);
        } else {
          setSelectedItemId(initialSelectedItemId);
          setModalMode('ISSUED_OUT');
          setQuantity(1);
          setRecipient('');
          setNotes('');
          setIsModalOpen(true);
        }
        onClearInitialSelectedItemId?.();
      }
    }
  }, [initialSelectedItemId, items, onClearInitialSelectedItemId]);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    onClearInitialSelectedItemId?.();
  };

  const handleCloseNoStockModal = () => {
    setIsNoStockModalOpen(false);
    setNoStockItem(null);
    onClearInitialSelectedItemId?.();
  };

  useEffect(() => {
    if (currentUser?.fullName || currentUser?.username) {
      setIssuedBy(currentUser.fullName ? `${currentUser.fullName} (${currentUser.username})` : currentUser.username);
    }
  }, [currentUser]);

  const selectedItem = items.find(i => i.id === selectedItemId);
  const currentAvailableStock = selectedItem ? (selectedItem.currentStock !== undefined ? selectedItem.currentStock : selectedItem.reorderQty) : 0;
  
  let calculatedNewStock = currentAvailableStock;
  if (modalMode === 'ISSUED_OUT') {
    calculatedNewStock = Math.max(0, currentAvailableStock - Number(quantity || 0));
  } else if (modalMode === 'RESTOCKED') {
    calculatedNewStock = currentAvailableStock + Number(quantity || 0);
  } else if (modalMode === 'ADJUSTMENT') {
    calculatedNewStock = Number(quantity || 0);
  }

  const willBeLowStock = selectedItem && modalMode === 'ISSUED_OUT' && calculatedNewStock <= selectedItem.minStockLevel;

  const handleOpenIssueModal = (itemToIssue?: InventoryItem) => {
    setModalMode('ISSUED_OUT');
    if (itemToIssue) {
      const available = itemToIssue.currentStock !== undefined ? itemToIssue.currentStock : itemToIssue.reorderQty;
      if (available <= 0) {
        setNoStockItem(itemToIssue);
        setIsNoStockModalOpen(true);
        return;
      }
      setSelectedItemId(itemToIssue.id);
    } else if (items.length > 0) {
      setSelectedItemId(items[0].id);
    }
    setQuantity(1);
    setRecipient('');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleOpenRestockModal = (itemToRestock?: InventoryItem) => {
    setModalMode('RESTOCKED');
    if (itemToRestock) {
      setSelectedItemId(itemToRestock.id);
    } else if (items.length > 0 && !selectedItemId) {
      setSelectedItemId(items[0].id);
    }
    setQuantity(1);
    setRecipient('Inventory Store');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleSubmitMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) {
      alert("Please select a valid inventory item.");
      return;
    }

    if (modalMode === 'ISSUED_OUT') {
      if (currentAvailableStock <= 0) {
        setNoStockItem(selectedItem);
        setIsNoStockModalOpen(true);
        return;
      }

      if (quantity > currentAvailableStock) {
        alert(`Cannot issue out ${quantity} ${selectedItem.unitOfMeasure}. Only ${currentAvailableStock} ${selectedItem.unitOfMeasure} available in current stock.`);
        return;
      }
    }

    const codeNumber = movements.length + 1;
    const movementCode = `MOV-${new Date().getFullYear()}-${String(codeNumber).padStart(3, '0')}`;

    const movementData: Omit<StockMovement, 'id' | 'createdAt' | 'updatedAt'> = {
      movementCode,
      movementType: modalMode,
      itemId: selectedItem.id,
      itemCode: selectedItem.itemCode || 'SKH-ITEM',
      itemName: selectedItem.itemName,
      category: selectedItem.category,
      quantity: Number(quantity),
      unitOfMeasure: selectedItem.unitOfMeasure,
      previousStock: currentAvailableStock,
      newStock: calculatedNewStock,
      recipient: recipient || (modalMode === 'RESTOCKED' ? 'Store Restock' : 'General Site Use'),
      issuedBy: issuedBy || currentUser?.fullName || currentUser?.username || 'System Administrator',
      date: movementDate,
      notes,
      createdBy: currentUser?.username || currentUser?.fullName || 'admin',
    };

    try {
      await stockMovementService.addMovement(movementData);
      setIsModalOpen(false);
      setQuantity(1);
      setNotes('');
      setRecipient('');
    } catch (err) {
      console.error(err);
      alert("Failed to record stock movement.");
    }
  };

  const handleDeleteMovement = async (id: string) => {
    if (confirm("Are you sure you want to delete this movement log record?")) {
      try {
        await stockMovementService.deleteMovement(id);
      } catch (err) {
        alert("Failed to delete movement record.");
      }
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

  const filteredMovements = movements.filter(m => {
    const matchesSearch = m.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.recipient.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.issuedBy.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'ALL' || m.movementType === filterType;
    
    // Date Range Filter
    const mDate = m.date || '';
    if (startDate && mDate < startDate) return false;
    if (endDate && mDate > endDate) return false;

    return matchesSearch && matchesType;
  });

  const totalIssuedCount = filteredMovements.filter(m => m.movementType === 'ISSUED_OUT').reduce((acc, m) => acc + m.quantity, 0);
  const totalRestockedCount = filteredMovements.filter(m => m.movementType === 'RESTOCKED').reduce((acc, m) => acc + m.quantity, 0);
  const lowStockItems = items.filter(i => i.status === 'LOW STOCK' || i.status === 'OUT OF STOCK');

  const getDateLabel = () => {
    if (!startDate && !endDate) return 'All Time';
    if (startDate === endDate && startDate) return `Date: ${startDate}`;
    if (startDate && endDate) return `Period: ${startDate} to ${endDate}`;
    if (startDate) return `From: ${startDate}`;
    if (endDate) return `Up to: ${endDate}`;
    return 'All Time';
  };

  const handleExportCSV = () => {
    const headers = `SAKA HOMES STOCK MOVEMENTS REPORT (${getDateLabel()})\n` +
      "Movement Code,Date,Type,Item Code,Item Name,Category,Qty Moved,Issued To / Site,Issued By (User Account),Logged By (User Account),Notes\n";
    const rows = filteredMovements.map(m => 
      `"${m.movementCode}","${m.date}","${m.movementType}","${m.itemCode}","${m.itemName}","${m.category}",${m.quantity},"${m.recipient}","${m.issuedBy}","${m.createdBy || 'system'}","${m.notes || ''}"`
    ).join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saka-homes-stock-movements-${datePreset.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportPDF = () => {
    exportStockMovementsPDF(filteredMovements, getDateLabel());
  };

  return (
    <div className="space-y-8 print:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-semibold tracking-tight text-[#1E1B4B]">Stock Movements & Site Dispatches</h1>
          <p className="text-slate-500 text-sm mt-1">Track materials issued out to site, restocked, or adjusted with real-time stock updates.</p>
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
                onAccessDenied?.('log inventory restocks');
                return;
              }
              handleOpenRestockModal();
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#1E1B4B] text-white rounded-xl text-xs font-bold shadow hover:bg-purple-950 transition-all"
          >
            <RefreshCw className="w-4 h-4 text-amber-300" />
            <span>Restock</span>
          </button>
          <button 
            onClick={() => {
              if (isViewer) {
                onAccessDenied?.('issue materials to construction sites');
                return;
              }
              handleOpenIssueModal();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#E54818] text-white rounded-xl font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] transition-all text-xs"
          >
            <Send className="w-4 h-4" />
            <span>Issue / Dispatch</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:hidden">
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Total Dispatched Out</p>
            <p className="text-3xl font-heading font-semibold text-[#E54818] mt-1 tabular-nums">{totalIssuedCount}</p>
            <p className="text-xs text-slate-500 mt-1">Material units issued to site</p>
          </div>
          <div className="p-3.5 bg-orange-50 text-[#E54818] rounded-2xl border border-orange-100">
            <Send className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Total Restocked</p>
            <p className="text-3xl font-heading font-semibold text-[#1E1B4B] mt-1 tabular-nums">{totalRestockedCount}</p>
            <p className="text-xs text-slate-500 mt-1">Units received into storage</p>
          </div>
          <div className="p-3.5 bg-purple-50 text-[#1E1B4B] rounded-2xl border border-purple-100">
            <RefreshCw className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Low/Out of Stock</p>
            <p className="text-3xl font-heading font-semibold text-rose-600 mt-1 tabular-nums">{lowStockItems.length}</p>
            <p className="text-xs text-slate-500 mt-1">Requires reorder dispatch</p>
          </div>
          <div className="p-3.5 bg-rose-50 text-rose-600 rounded-2xl border border-rose-100">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Date Filter & Preset Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[#1E293B]">
            <Filter className="w-4 h-4 text-blue-600" />
            <span>Date Scope Filter (Applies to Table & CSV Export):</span>
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
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0] hover:text-[#1E293B]"
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

        {/* Date Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end pt-2 border-t border-[#F1F5F9]">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-[#64748B] tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-blue-600" />
              From Date
            </label>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-3 py-2 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border border-transparent focus:bg-white text-xs font-bold text-[#1E293B] transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase text-[#64748B] tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-blue-600" />
              To Date
            </label>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-3 py-2 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border border-transparent focus:bg-white text-xs font-bold text-[#1E293B] transition-all"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-2 rounded-xl border border-blue-100 w-full text-center">
              Active: {getDateLabel()} ({filteredMovements.length} logs)
            </span>
          </div>
        </div>
      </div>

      {/* Movement Filter Bar */}
      <div className="flex flex-wrap gap-2 print:hidden">
        {[
          { id: 'ALL', label: 'All Movements' },
          { id: 'ISSUED_OUT', label: 'Issued Out' },
          { id: 'RESTOCKED', label: 'Restocked' },
          { id: 'ADJUSTMENT', label: 'Adjustments' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold tracking-wider transition-all",
              filterType === tab.id 
                ? "bg-blue-600 text-white shadow-sm" 
                : "bg-white border border-slate-200/80 text-[#64748B] hover:border-blue-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Movements Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h2 className="text-xl font-heading font-semibold text-[#1E1B4B]">Movement Audit Log</h2>
            <p className="text-xs text-[#64748B]">Complete history of material dispatches, site issues, and store restocks.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[1100px]">
            <thead className="bg-[#F8FAFC]">
              <tr>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Ref Code & Date</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Type</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Item Name</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Qty Moved</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Destination / Recipient</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em]">Issued By</th>
                <th className="px-6 py-4 text-[11px] font-semibold text-slate-500 uppercase tracking-[0.12em] print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-6 py-5"><div className="h-4 bg-gray-100 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredMovements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-[#94A3B8]">
                    No stock movement logs found. Click "Issue Item Out" above to record material dispatch.
                  </td>
                </tr>
              ) : filteredMovements.map((m) => (
                <tr key={m.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs font-bold text-[#1E293B]">{m.movementCode}</span>
                      <span className="text-[11px] text-[#94A3B8]">{m.date}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase inline-flex items-center gap-1",
                      m.movementType === 'ISSUED_OUT' ? "bg-amber-100 text-amber-800" :
                      m.movementType === 'RESTOCKED' ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                    )}>
                      {m.movementType === 'ISSUED_OUT' && <Send className="w-3 h-3" />}
                      {m.movementType === 'RESTOCKED' && <RefreshCw className="w-3 h-3" />}
                      {m.movementType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="font-bold text-[#1E293B]">{m.itemName}</span>
                      <span className="text-[10px] font-mono text-[#94A3B8]">{m.itemCode} ({m.category})</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <span className={cn(
                      "font-bold text-sm",
                      m.movementType === 'ISSUED_OUT' ? "text-amber-600" : "text-emerald-600"
                    )}>
                      {m.movementType === 'ISSUED_OUT' ? `-${m.quantity}` : `+${m.quantity}`} {m.unitOfMeasure}
                    </span>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 text-xs font-medium text-[#1E293B]">
                      <Building2 className="w-3.5 h-3.5 text-[#94A3B8]" />
                      <span>{m.recipient}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 text-xs text-[#64748B]">
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-[#94A3B8]" />
                      <span>{m.issuedBy}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5 print:hidden">
                    <button 
                      onClick={() => handleDeleteMovement(m.id)}
                      title="Delete Record"
                      className="p-2 text-[#94A3B8] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Issue Out / Restock Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseModal}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-3 rounded-2xl",
                    modalMode === 'ISSUED_OUT' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  )}>
                    {modalMode === 'ISSUED_OUT' ? <Send className="w-5 h-5" /> : <RefreshCw className="w-5 h-5" />}
                  </div>
                  <div>
                    <h2 className="text-xl font-heading font-semibold text-[#1E1B4B]">
                      {modalMode === 'ISSUED_OUT' ? 'Issue Material / Item Out' : 'Restock / Recalibrate Stock'}
                    </h2>
                    <p className="text-xs text-[#64748B]">Update current stock levels automatically.</p>
                  </div>
                </div>
                <button onClick={handleCloseModal} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitMovement} className="p-6 overflow-y-auto space-y-5">
                {/* Movement Mode selector */}
                <div className="flex bg-[#F1F5F9] p-1 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setModalMode('ISSUED_OUT')}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                      modalMode === 'ISSUED_OUT' ? "bg-amber-600 text-white shadow" : "text-[#64748B]"
                    )}
                  >
                    <Send className="w-3.5 h-3.5" />
                    Issue Out
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalMode('RESTOCKED')}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                      modalMode === 'RESTOCKED' ? "bg-emerald-600 text-white shadow" : "text-[#64748B]"
                    )}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Restock
                  </button>
                </div>

                {/* Item Picker */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Select Inventory Item</label>
                  <select 
                    value={selectedItemId} 
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-sm font-semibold"
                  >
                    {items.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.itemCode} - {item.itemName} (Available: {item.currentStock !== undefined ? item.currentStock : item.reorderQty} {item.unitOfMeasure})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedItem && (
                  <div className="bg-[#F8FAFC] border border-[#E2E8F0] p-4 rounded-2xl text-xs space-y-2">
                    <div className="flex justify-between items-center text-[#64748B]">
                      <span>Current Available Stock:</span>
                      <span className="font-bold text-[#1E293B]">{currentAvailableStock} {selectedItem.unitOfMeasure}</span>
                    </div>
                    <div className="flex justify-between items-center text-[#64748B]">
                      <span>Minimum Stock Level:</span>
                      <span className="font-bold text-[#1E293B]">{selectedItem.minStockLevel} {selectedItem.unitOfMeasure}</span>
                    </div>
                    <div className="border-t border-[#E2E8F0] pt-2 flex justify-between items-center">
                      <span className="font-bold">Projected New Stock:</span>
                      <span className={cn(
                        "font-bold text-sm",
                        willBeLowStock ? "text-red-600" : "text-emerald-600"
                      )}>
                        {calculatedNewStock} {selectedItem.unitOfMeasure}
                      </span>
                    </div>
                    {willBeLowStock && currentAvailableStock > 0 && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-2.5 rounded-xl flex items-center gap-2 mt-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                        <p className="text-[11px] font-medium">Warning: This issuance will reduce stock below the Minimum Level ({selectedItem.minStockLevel}) and flag item as <strong>LOW STOCK</strong>.</p>
                      </div>
                    )}
                    {currentAvailableStock <= 0 && modalMode === 'ISSUED_OUT' && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-2xl flex items-start gap-2.5 mt-2">
                        <PackageX className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-rose-900">No Quantity Stock Available</p>
                          <p className="text-[11px] text-rose-700 mt-0.5">
                            Current available stock is <strong>0 {selectedItem.unitOfMeasure}</strong>. This item cannot be issued out until it is restocked.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">
                      Quantity to {modalMode === 'ISSUED_OUT' ? 'Issue' : 'Restock'}
                    </label>
                    <input 
                      type="number" 
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 0))}
                      required 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Date</label>
                    <input 
                      type="date" 
                      value={movementDate}
                      onChange={(e) => setMovementDate(e.target.value)}
                      required 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-xs font-semibold" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">
                    {modalMode === 'ISSUED_OUT' ? 'Destination Site / Recipient Name' : 'Supplier / Source'}
                  </label>
                  <input 
                    type="text" 
                    placeholder={modalMode === 'ISSUED_OUT' ? 'e.g. Site A - Foundation Crew / Eng. Frank' : 'e.g. Main Store Restock / Supplier Delivery'} 
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-sm" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Issued / Handled By</label>
                  <input 
                    type="text" 
                    value={issuedBy}
                    onChange={(e) => setIssuedBy(e.target.value)}
                    required
                    placeholder="e.g. Storekeeper / Supervisor"
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-sm" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Notes / Purpose</label>
                  <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Material for concrete slab pouring"
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-sm h-20" 
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={handleCloseModal} className="flex-1 py-3 border border-slate-200/80 rounded-xl font-bold text-[#64748B] hover:bg-[#F8FAFC]">Cancel</button>
                  <button 
                    type="submit" 
                    className={cn(
                      "flex-1 py-3 text-white rounded-xl font-bold shadow-lg transition-all",
                      modalMode === 'ISSUED_OUT' ? "bg-amber-600 hover:bg-amber-700 shadow-amber-100" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100"
                    )}
                  >
                    Confirm {modalMode === 'ISSUED_OUT' ? 'Issuance' : 'Restock'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* No Stock Alert Modal */}
      <NoStockModal
        isOpen={isNoStockModalOpen}
        onClose={handleCloseNoStockModal}
        itemName={noStockItem?.itemName}
        itemCode={noStockItem?.itemCode}
        unitOfMeasure={noStockItem?.unitOfMeasure}
        onRestock={() => {
          if (noStockItem) {
            handleOpenRestockModal(noStockItem);
          }
        }}
      />
    </div>
  );
}
