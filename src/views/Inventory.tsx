import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Edit2, 
  Trash2, 
  AlertCircle,
  FileDown,
  FileText,
  X,
  Send,
  Calendar as CalendarIcon,
  LayoutGrid,
  List,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryItem, Category, UserRole, AppUser } from '../types';
import { inventoryService, categoryService } from '../services/dataService';
import { formatCurrency, cn } from '../lib/utils';
import { exportInventoryPDF } from '../lib/pdfExport';
import { format, startOfWeek, startOfMonth, startOfQuarter } from 'date-fns';
import NoStockModal from '../components/NoStockModal';

type DatePreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER' | 'CUSTOM';

interface InventoryProps {
  searchQuery: string;
  forceOpenModal?: boolean;
  onModalClose?: () => void;
  onIssueItem?: (itemId: string) => void;
  userRole?: UserRole;
  currentUser?: AppUser;
  onAccessDenied?: (actionName?: string) => void;
}

export default function Inventory({ searchQuery, forceOpenModal, onModalClose, onIssueItem, userRole = 'ADMIN', currentUser, onAccessDenied }: InventoryProps) {
  const isViewer = userRole !== 'ADMIN' && userRole !== 'MANAGER';
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [formItemCode, setFormItemCode] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper to generate guaranteed unique item code
  const generateUniqueItemCode = (categoryName?: string) => {
    let catPrefix = 'SKH';
    if (categoryName) {
      const cleaned = categoryName.replace(/[^a-zA-Z]/g, '');
      if (cleaned.length >= 3) {
        catPrefix = `SKH-${cleaned.substring(0, 3).toUpperCase()}`;
      }
    }
    let candidate = '';
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 100) {
      const randNum = Math.floor(100 + Math.random() * 900);
      candidate = `${catPrefix}-${randNum}`;
      if (!items.some(i => i.itemCode.toLowerCase() === candidate.toLowerCase())) {
        isUnique = true;
      }
      attempts++;
    }
    return candidate || `SKH-${Date.now().toString().slice(-4)}`;
  };

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setFormError(null);
    const initialCategory = categories[0]?.categoryName || 'Cement & concrete';
    setFormItemCode(generateUniqueItemCode(initialCategory));
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFormError(null);
    setFormItemCode(item.itemCode);
    setIsModalOpen(true);
  };

  // Zero stock alert modal state
  const [noStockItem, setNoStockItem] = useState<InventoryItem | null>(null);
  const [isNoStockModalOpen, setIsNoStockModalOpen] = useState(false);

  // Date Range Filter State
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    if (forceOpenModal) {
      handleOpenAddModal();
      if (onModalClose) onModalClose();
    }
  }, [forceOpenModal, onModalClose]);

  useEffect(() => {
    const unsubInventory = inventoryService.subscribe((newItems) => {
      setItems(newItems);
      setLoading(false);
    });
    const unsubCategories = categoryService.subscribe((newCats) => {
      setCategories(newCats);
    });
    return () => {
      unsubInventory();
      unsubCategories();
    };
  }, []);

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

  const filteredItems = items.filter(item => {
    const matchesSearch = item.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.itemCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.supplier.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'ALL' || item.status === filterStatus;

    if (startDate || endDate) {
      const itemDate = item.lastRestocked || '';
      if (startDate && itemDate && itemDate < startDate) return false;
      if (endDate && itemDate && itemDate > endDate) return false;
    }

    return matchesSearch && matchesStatus;
  });

  const handleIssueClick = (item: InventoryItem) => {
    if (isViewer) {
      onAccessDenied?.('issue materials to construction sites');
      return;
    }
    const currentStock = item.currentStock !== undefined ? item.currentStock : item.reorderQty;
    if (currentStock <= 0) {
      setNoStockItem(item);
      setIsNoStockModalOpen(true);
      return;
    }
    onIssueItem?.(item.id);
  };

  const handleAddItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const formData = new FormData(e.currentTarget);
    const rawItemCode = (formItemCode || (formData.get('itemCode') as string) || '').trim();

    if (!rawItemCode) {
      setFormError('Please provide or generate a valid Item Code.');
      return;
    }

    // Client-side duplicate check
    const duplicate = items.find(
      i => i.id !== editingItem?.id && i.itemCode.trim().toLowerCase() === rawItemCode.toLowerCase()
    );
    if (duplicate) {
      setFormError(`Item Code "${rawItemCode}" is already in use by "${duplicate.itemName}". Please choose or generate a unique code.`);
      return;
    }

    const rawNotes = (formData.get('notes') as string || '').trim();
    if (editingItem && !rawNotes) {
      setFormError('Notes are required when editing an inventory item. Please provide a reason for the modification.');
      return;
    }

    const minLevel = Number(formData.get('minStockLevel') || 0);
    const qtyInput = formData.get('quantity') ?? formData.get('reorderQty') ?? formData.get('currentStock');
    const quantity = qtyInput !== null && qtyInput !== '' ? Number(qtyInput) : 0;
    const dateReceived = (formData.get('lastRestocked') as string || formData.get('dateReceived') as string || '').trim() || format(new Date(), 'yyyy-MM-dd');
    
    let calcStatus: 'IN STOCK' | 'LOW STOCK' | 'OUT OF STOCK' = 'IN STOCK';
    if (quantity <= 0) {
      calcStatus = 'OUT OF STOCK';
    } else if (quantity <= minLevel) {
      calcStatus = 'LOW STOCK';
    }

    const itemData = {
      itemCode: rawItemCode,
      itemName: (formData.get('itemName') as string || '').trim(),
      category: (formData.get('category') as string || '').trim(),
      unitOfMeasure: (formData.get('unitOfMeasure') as string || 'Units').trim(),
      minStockLevel: minLevel,
      maxStockLevel: editingItem?.maxStockLevel || Math.max(1000, minLevel * 10, quantity * 5),
      reorderQty: quantity,
      currentStock: quantity,
      unitCost: Number(formData.get('unitCost') || 0),
      totalValue: Number(formData.get('unitCost') || 0) * quantity,
      status: (formData.get('status') as any) || calcStatus,
      supplier: (formData.get('supplier') as string || '').trim(),
      lastRestocked: dateReceived,
      nextReviewDate: (formData.get('nextReviewDate') as string) || '',
      notes: rawNotes,
      createdBy: currentUser?.username || currentUser?.fullName || 'admin',
    };

    try {
      setIsSubmitting(true);
      if (editingItem) {
        await inventoryService.updateItem(editingItem.id, itemData);
      } else {
        await inventoryService.addItem(itemData);
        categoryService.syncItemCount(itemData.category);
      }
      setIsModalOpen(false);
      setEditingItem(null);
      setFormError(null);
    } catch (err: any) {
      console.error('Error saving inventory item:', err);
      setFormError(err.message || 'Failed to save inventory item. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, category: string) => {
    if (userRole !== 'ADMIN') {
      if (onAccessDenied) onAccessDenied('permanently delete inventory items (Admin access required)');
      return;
    }
    const confirmed = confirm('Are you sure you want to delete this item?');
    if (confirmed) {
      try {
        await inventoryService.deleteItem(id);
        categoryService.syncItemCount(category);
      } catch (error: any) {
        alert(error?.message || "Failed to delete item. You might not have permission.");
      }
    }
  };

  const getDateLabel = () => {
    if (!startDate && !endDate) return 'All Time';
    if (startDate === endDate && startDate) return `Date: ${startDate}`;
    if (startDate && endDate) return `Period: ${startDate} to ${endDate}`;
    if (startDate) return `From: ${startDate}`;
    if (endDate) return `Up to: ${endDate}`;
    return 'All Time';
  };

  const handleExport = () => {
    const headerTitle = `SAKA HOMES INVENTORY LIST (${getDateLabel()})\n`;
    const headers = "Item Code,Item Name,Category,Unit,Current Stock,Min Level,Max Level,Unit Cost (GHS),Total Valuation (GHS),Supplier,Added By (User Account),Last Restocked,Status\n";
    const rows = filteredItems.map(i => {
      const currStock = i.currentStock !== undefined ? i.currentStock : i.reorderQty;
      const val = (i.unitCost || 0) * currStock;
      return `"${i.itemCode}","${i.itemName}","${i.category}","${i.unitOfMeasure}",${currStock},${i.minStockLevel},${i.maxStockLevel},${i.unitCost},${val},"${i.supplier || ''}","${i.createdBy || 'system'}","${i.lastRestocked || ''}","${i.status}"`;
    }).join('\n');

    const blob = new Blob([headerTitle + headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saka-homes-inventory-${datePreset.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleExportPDF = () => {
    exportInventoryPDF(filteredItems, getDateLabel());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold tracking-tight text-[#1E1B4B]">Inventory Tracker</h1>
          <p className="text-slate-500 text-sm mt-1">Manage and track all materials for current and future projects.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-[#1E1B4B] hover:bg-[#FAF8F5] transition-all shadow-2xs"
            title="Export as CSV spreadsheet"
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
                onAccessDenied?.('add new material items');
                return;
              }
              handleOpenAddModal();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#E54818] text-white rounded-xl font-bold shadow-md shadow-orange-600/20 hover:bg-[#C83A0F] transition-all text-xs"
          >
            <Plus className="w-4 h-4" />
            Add Item
          </button>
        </div>
      </div>

      {/* Date Range & Preset Filter Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[#1E1B4B]">
            <Filter className="w-4 h-4 text-[#E54818]" />
            <span>Date Scope Filter (Applies to Items & CSV Export):</span>
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
            <label className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-[#E54818]" />
              From Date (Restocked)
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
            <label className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3 h-3 text-[#E54818]" />
              To Date (Restocked)
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
              Active Scope: {getDateLabel()} ({filteredItems.length} items)
            </span>
          </div>
        </div>
      </div>

      {/* Status Filters & View Mode Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {['ALL', 'IN STOCK', 'LOW STOCK', 'OUT OF STOCK'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-wider transition-all",
                filterStatus === status 
                  ? "bg-slate-900 text-white shadow-sm" 
                  : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
              )}
            >
              {status}
            </button>
          ))}
        </div>

        {/* View Switcher Buttons */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80 self-start sm:self-auto">
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              viewMode === 'table' ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <List className="w-4 h-4" />
            <span className="hidden sm:inline">Table</span>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              viewMode === 'grid' ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* Grid or Table Display */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => {
            const currStock = item.currentStock !== undefined ? item.currentStock : item.reorderQty;
            const pct = Math.min(100, Math.round((currStock / Math.max(1, item.maxStockLevel)) * 100));

            return (
              <div 
                key={item.id} 
                className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between space-y-4 group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="px-2.5 py-1 bg-purple-50 text-[#1E1B4B] border border-purple-100 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                      {item.category}
                    </span>
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                      item.status === 'IN STOCK' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                      item.status === 'LOW STOCK' ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-rose-50 text-rose-700 border border-rose-200"
                    )}>
                      {item.status}
                    </span>
                  </div>

                  <h3 className="font-heading font-semibold text-base text-[#1E1B4B] group-hover:text-[#E54818] transition-colors">
                    {item.itemName}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">{item.itemCode || 'N/A'}</p>

                  <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Unit Cost</p>
                      <p className="font-heading font-semibold text-slate-900 text-sm">{formatCurrency(item.unitCost)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400">Valuation</p>
                      <p className="font-heading font-semibold text-[#E54818] text-sm">{formatCurrency((item.unitCost || 0) * currStock)}</p>
                    </div>
                  </div>

                  {/* Meter */}
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-[11px] font-semibold text-slate-600">
                      <span>Stock: <strong className="text-slate-900">{currStock} {item.unitOfMeasure}</strong></span>
                      <span>Min: {item.minStockLevel}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          item.status === 'IN STOCK' ? "bg-emerald-500" :
                          item.status === 'LOW STOCK' ? "bg-amber-500" : "bg-rose-500"
                        )}
                        style={{ width: `${Math.max(6, pct)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 truncate max-w-[120px]">
                    {item.supplier || 'No Supplier'}
                  </span>
                  <div className="flex items-center gap-1">
                    {onIssueItem && (
                      <button 
                        onClick={() => handleIssueClick(item)}
                        className="px-2.5 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Issue</span>
                      </button>
                    )}
                    <button 
                      onClick={() => {
                        if (isViewer) {
                          onAccessDenied?.('edit material item details');
                          return;
                        }
                        handleOpenEditModal(item); 
                      }}
                      className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"
                      title="Edit Item"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => {
                        if (isViewer) {
                          onAccessDenied?.('delete inventory records');
                          return;
                        }
                        handleDelete(item.id, item.category);
                      }}
                      className="p-1.5 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-lg transition-colors"
                      title="Delete Item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table Section */
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[1100px]">
              <thead className="bg-slate-50/80 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Item Code</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Item Name & Supplier</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Unit</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Quantity</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Min Level</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Date Received</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Unit Cost</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-6 py-5"><div className="h-4 bg-slate-100 rounded w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-16 text-center text-slate-400">
                      No materials match your filter criteria.
                    </td>
                  </tr>
                ) : filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">{item.itemCode || '-'}</td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{item.itemName}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{item.supplier || 'No supplier'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-slate-100 text-slate-700 rounded-lg text-[11px] font-bold">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{item.unitOfMeasure}</td>
                    <td className="px-6 py-4 font-heading font-bold text-slate-900 text-sm">
                      {item.currentStock !== undefined ? item.currentStock : item.reorderQty}
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-semibold">
                      {item.minStockLevel}
                    </td>
                    <td className="px-6 py-4 text-slate-500 font-mono text-[11px]">
                      {item.lastRestocked || '-'}
                    </td>
                    <td className="px-6 py-4 font-bold text-blue-600">
                      {formatCurrency(item.unitCost)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                        item.status === 'IN STOCK' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                        item.status === 'LOW STOCK' ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-rose-50 text-rose-700 border border-rose-200"
                      )}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onIssueItem && (
                          <button 
                            onClick={() => handleIssueClick(item)}
                            title="Issue Item Out"
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Issue</span>
                          </button>
                        )}
                        <button 
                          onClick={() => {
                            if (isViewer) {
                              onAccessDenied?.('edit material item details');
                              return;
                            }
                            handleOpenEditModal(item); 
                          }}
                          className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"
                          title="Edit Item"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            if (isViewer) {
                              onAccessDenied?.('delete inventory records');
                              return;
                            }
                            handleDelete(item.id, item.category);
                          }}
                          className="p-1.5 hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-lg transition-colors"
                          title="Delete Item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isSubmitting) setIsModalOpen(false);
              }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="p-8 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
                <div>
                  <h2 className="text-2xl font-heading font-semibold text-[#1E1B4B]">{editingItem ? 'Edit Item' : 'Add New Item'}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {editingItem ? `Updating ${editingItem.itemName}` : 'Create a new material record with unique item code'}
                  </p>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  disabled={isSubmitting}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors disabled:opacity-40"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleAddItem} className="p-8 overflow-y-auto space-y-6">
                {/* Form Error Banner */}
                {formError && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-sm">
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Unable to Save Item</p>
                      <p className="text-xs text-rose-700 mt-0.5">{formError}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Item Name</label>
                    <input 
                      name="itemName" 
                      defaultValue={editingItem?.itemName} 
                      required 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-slate-900 font-medium" 
                      placeholder="e.g. Portland Cement Grade 42.5" 
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Item Code</label>
                      <button
                        type="button"
                        onClick={() => {
                          const formEl = document.querySelector('select[name="category"]') as HTMLSelectElement;
                          const selectedCat = formEl?.value;
                          setFormItemCode(generateUniqueItemCode(selectedCat));
                          setFormError(null);
                        }}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
                        title="Generate a unique SKU code"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Auto-generate</span>
                      </button>
                    </div>
                    <input 
                      name="itemCode" 
                      value={formItemCode}
                      onChange={(e) => {
                        setFormItemCode(e.target.value);
                        setFormError(null);
                      }}
                      required 
                      className={cn(
                        "w-full px-4 py-3 rounded-xl outline-none focus:ring-2 border-2 transition-all font-mono font-bold text-sm",
                        items.some(i => i.id !== editingItem?.id && i.itemCode.trim().toLowerCase() === formItemCode.trim().toLowerCase())
                          ? "border-rose-400 focus:ring-rose-400 bg-rose-50 text-rose-900"
                          : "border-transparent bg-[#F1F5F9] focus:ring-blue-400 focus:bg-white text-slate-900"
                      )} 
                      placeholder="e.g. SKH-CEM-101" 
                    />
                    {items.some(i => i.id !== editingItem?.id && i.itemCode.trim().toLowerCase() === formItemCode.trim().toLowerCase()) && (
                      <p className="text-[11px] text-rose-600 font-semibold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Code already taken. Click Auto-generate for a unique code.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Category</label>
                      <span className="text-[10px] text-slate-400 font-semibold">{categories.length} available</span>
                    </div>
                    <select 
                      name="category" 
                      defaultValue={editingItem?.category || (categories[0]?.categoryName || 'Cement & concrete')} 
                      onChange={(e) => {
                        if (!editingItem) {
                          setFormItemCode(generateUniqueItemCode(e.target.value));
                        }
                      }}
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-medium text-slate-800"
                    >
                      {categories.length > 0 ? (
                        categories.map((cat) => (
                          <option key={cat.id} value={cat.categoryName}>
                            {cat.categoryName}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="Cement & concrete">Cement & concrete</option>
                          <option value="Steel & iron">Steel & iron</option>
                          <option value="Roofing">Roofing</option>
                          <option value="Plumbing">Plumbing</option>
                          <option value="Electrical">Electrical</option>
                          <option value="Finishes & Tiles">Finishes & Tiles</option>
                          <option value="Tools & Hardware">Tools & Hardware</option>
                        </>
                      )}
                      {editingItem?.category && !categories.some(c => c.categoryName.toLowerCase() === editingItem.category.toLowerCase()) && (
                        <option value={editingItem.category}>
                          {editingItem.category}
                        </option>
                      )}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Unit of Measure</label>
                    <input name="unitOfMeasure" defaultValue={editingItem?.unitOfMeasure} required className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" placeholder="e.g. Bags, Tonnes, Boxes" />
                  </div>

                  {/* Quantity Field (Replaces Reorder Quantity & Current Available) */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Quantity</label>
                    <input 
                      type="number" 
                      name="quantity" 
                      min="0"
                      defaultValue={editingItem ? (editingItem.currentStock !== undefined ? editingItem.currentStock : editingItem.reorderQty) : undefined} 
                      required 
                      placeholder="e.g. 100" 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-bold text-slate-900" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Min Stock Level</label>
                    <input 
                      type="number" 
                      name="minStockLevel" 
                      min="0"
                      defaultValue={editingItem?.minStockLevel ?? 10} 
                      required 
                      placeholder="e.g. 20" 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Unit Cost (GHS)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0"
                      name="unitCost" 
                      defaultValue={editingItem?.unitCost} 
                      required 
                      placeholder="e.g. 85.00" 
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Status</label>
                    <select name="status" defaultValue={editingItem?.status || 'IN STOCK'} className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all appearance-none font-medium">
                      <option value="IN STOCK">IN STOCK</option>
                      <option value="LOW STOCK">LOW STOCK</option>
                      <option value="OUT OF STOCK">OUT OF STOCK</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Supplier</label>
                    <input name="supplier" defaultValue={editingItem?.supplier} required className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" placeholder="e.g. RoofMaster Ltd" />
                  </div>

                  {/* Date Received Field (Replaces Last Restocked) */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Date Received</label>
                    <input 
                      type="date" 
                      name="lastRestocked" 
                      defaultValue={editingItem?.lastRestocked || format(new Date(), 'yyyy-MM-dd')} 
                      required
                      className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all font-medium text-slate-800" 
                    />
                  </div>
                </div>

                {/* Notes Section - Mandatory on edits */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider flex items-center gap-1.5">
                      <span>Notes</span>
                      {editingItem ? (
                        <span className="text-rose-600 font-bold normal-case text-[11px] bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                          * Required for item edits
                        </span>
                      ) : (
                        <span className="text-slate-400 font-normal normal-case text-[11px]">(Optional)</span>
                      )}
                    </label>
                  </div>
                  <textarea 
                    name="notes" 
                    defaultValue={editingItem?.notes} 
                    required={Boolean(editingItem)}
                    placeholder={editingItem ? "Please describe the reason for this edit or stock adjustment (mandatory for audits)..." : "Additional material specifications, storage location, or batch details (optional)..."}
                    className={cn(
                      "w-full px-4 py-3 rounded-xl outline-none focus:ring-2 border-2 transition-all h-24 text-slate-800",
                      editingItem 
                        ? "bg-[#F8FAFC] border-slate-200 focus:border-blue-400 focus:ring-blue-400 focus:bg-white" 
                        : "bg-[#F1F5F9] border-transparent focus:border-blue-400 focus:ring-blue-400 focus:bg-white"
                    )} 
                  />
                </div>
                
                <div className="pt-6 flex gap-4">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)} 
                    disabled={isSubmitting}
                    className="flex-1 px-6 py-4 border border-slate-200/80 rounded-2xl font-bold text-[#64748B] hover:bg-[#F8FAFC] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    disabled={isSubmitting || items.some(i => i.id !== editingItem?.id && i.itemCode.trim().toLowerCase() === formItemCode.trim().toLowerCase())}
                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSubmitting ? 'Saving...' : (editingItem ? 'Update Item' : 'Add Item')}
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
        onClose={() => {
          setIsNoStockModalOpen(false);
          setNoStockItem(null);
        }}
        itemName={noStockItem?.itemName}
        itemCode={noStockItem?.itemCode}
        unitOfMeasure={noStockItem?.unitOfMeasure}
      />
    </div>
  );
}
