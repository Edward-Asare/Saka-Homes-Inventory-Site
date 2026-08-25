import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  Calendar as CalendarIcon, 
  BarChart2, 
  FileSpreadsheet,
  ArrowUpRight,
  TrendingUp,
  PieChart as PieChartIcon,
  Send,
  Building2,
  Filter,
  ShoppingCart,
  ArrowLeftRight,
  RefreshCw,
  X,
  CheckCircle2,
  User
} from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryItem, StockMovement, PurchaseOrder, AppUser } from '../types';
import { inventoryService, stockMovementService, poService } from '../services/dataService';
import { formatCurrency, formatNumber, cn } from '../lib/utils';
import { exportReportPDF } from '../lib/pdfExport';
import { format, subDays, startOfWeek, startOfMonth, startOfQuarter, endOfDay, isWithinInterval, parseISO } from 'date-fns';
import SakaHomesLogo from '../components/SakaHomesLogo';

type DatePreset = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_QUARTER' | 'CUSTOM';
type ReportScope = 'ALL' | 'MOVEMENTS' | 'PURCHASE_ORDERS' | 'CATEGORY_SUMMARY';

interface ReportsProps {
  searchQuery?: string;
  currentUser?: AppUser;
}

export default function Reports({ searchQuery = '', currentUser }: ReportsProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Date Filtering State
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reportScope, setReportScope] = useState<ReportScope>('ALL');

  useEffect(() => {
    const unsubItems = inventoryService.subscribe((newItems) => {
      setItems(newItems);
      setLoading(false);
    });
    const unsubMovements = stockMovementService.subscribe((data) => {
      setMovements(data);
    });
    const unsubPOs = poService.subscribe((data) => {
      setPos(data);
    });

    return () => {
      unsubItems();
      unsubMovements();
      unsubPOs();
    };
  }, []);

  // Handle preset selection
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

  // Filter movements by date range
  const filteredMovements = movements.filter((m) => {
    if (!m.date) return true;
    if (startDate && m.date < startDate) return false;
    if (endDate && m.date > endDate) return false;
    return true;
  });

  // Filter Purchase Orders by date range
  const filteredPOs = pos.filter((po) => {
    const poDate = po.orderDate || '';
    if (!poDate) return true;
    if (startDate && poDate < startDate) return false;
    if (endDate && poDate > endDate) return false;
    return true;
  });

  const categories: string[] = Array.from(new Set(items.map(i => String(i.category))));
  
  const reportData = categories.map((cat: string) => {
    const catItems = items.filter(i => i.category === cat);
    return {
      category: cat,
      totalItems: catItems.length,
      outOfStock: catItems.filter(i => i.status === 'OUT OF STOCK').length,
      lowStock: catItems.filter(i => i.status === 'LOW STOCK').length,
      inStock: catItems.filter(i => i.status === 'IN STOCK').length,
      totalValue: catItems.reduce((acc, i) => acc + (i.unitCost * (i.currentStock !== undefined ? i.currentStock : i.reorderQty)), 0)
    };
  });

  const totals = reportData.reduce((acc, curr) => ({
    totalItems: acc.totalItems + curr.totalItems,
    outOfStock: acc.outOfStock + curr.outOfStock,
    lowStock: acc.lowStock + curr.lowStock,
    inStock: acc.inStock + curr.inStock,
    totalValue: acc.totalValue + curr.totalValue
  }), { totalItems: 0, outOfStock: 0, lowStock: 0, inStock: 0, totalValue: 0 });

  const totalIssuedQtyInPeriod = filteredMovements
    .filter(m => m.movementType === 'ISSUED_OUT')
    .reduce((acc, m) => acc + m.quantity, 0);

  const totalRestockedQtyInPeriod = filteredMovements
    .filter(m => m.movementType === 'RESTOCKED')
    .reduce((acc, m) => acc + m.quantity, 0);

  const totalProcurementSpendInPeriod = filteredPOs
    .reduce((acc, po) => acc + (po.totalCost || 0), 0);

  const getDateLabel = () => {
    if (!startDate && !endDate) return 'All Historical Data';
    if (startDate === endDate && startDate) return `Date: ${startDate}`;
    if (startDate && endDate) return `Period: ${startDate} to ${endDate}`;
    if (startDate) return `From: ${startDate}`;
    if (endDate) return `Up to: ${endDate}`;
    return 'All Time';
  };

  const handleDownloadPDF = () => {
    exportReportPDF({
      reportData,
      totals,
      movements: filteredMovements,
      pos: filteredPOs,
      reportScope,
      dateLabel: getDateLabel()
    });
  };

  const handlePrintPage = () => {
    window.print();
  };

  const handleExportExcel = () => {
    const dateRangeLabel = getDateLabel();
    let csvContent = `SAKA HOMES INVENTORY & LOGISTICS REPORT (${dateRangeLabel})\n`;
    csvContent += `Generated On: ${new Date().toLocaleString()}\n\n`;

    if (reportScope === 'ALL' || reportScope === 'CATEGORY_SUMMARY') {
      csvContent += "=== CATEGORY INVENTORY SUMMARY ===\n";
      csvContent += "Category,Total Items,Out of Stock,Low Stock,In Stock,Total Valuation (GHS)\n";
      reportData.forEach(r => {
        csvContent += `"${r.category}",${r.totalItems},${r.outOfStock},${r.lowStock},${r.inStock},${r.totalValue}\n`;
      });
      csvContent += `Grand Total,${totals.totalItems},${totals.outOfStock},${totals.lowStock},${totals.inStock},${totals.totalValue}\n\n`;
    }

    if (reportScope === 'ALL' || reportScope === 'MOVEMENTS') {
      csvContent += `=== STOCK MOVEMENTS & ISSUED ITEMS LOG (${filteredMovements.length} records) ===\n`;
      csvContent += "Ref Code,Date,Type,Item Code,Item Name,Category,Qty,Recipient / Site,Issued By (User Account),Logged By (User Account),Notes\n";
      filteredMovements.forEach(m => {
        csvContent += `"${m.movementCode}","${m.date}","${m.movementType}","${m.itemCode}","${m.itemName}","${m.category}",${m.quantity},"${m.recipient}","${m.issuedBy}","${m.createdBy || 'system'}","${m.notes || ''}"\n`;
      });
      csvContent += `Total Issued Units in Period,${totalIssuedQtyInPeriod}\n\n`;
    }

    if (reportScope === 'ALL' || reportScope === 'PURCHASE_ORDERS') {
      csvContent += `=== PURCHASE ORDERS & PROCUREMENT LOG (${filteredPOs.length} records) ===\n`;
      csvContent += "PO Number,Order Date,Expected Date,Item Code,Item Name,Supplier,Qty Ordered,Unit Cost (GHS),Total Cost (GHS),Issued By (User Account),Status,Notes\n";
      filteredPOs.forEach(po => {
        csvContent += `"${po.poNumber}","${po.orderDate}","${po.expectedDate}","${po.itemCode}","${po.itemName}","${po.supplier}",${po.qtyOrdered},${po.unitCost},${po.totalCost},"${po.createdBy || 'admin'}","${po.status}","${po.notes || ''}"\n`;
      });
      csvContent += `Total Procurement Spend in Period,${totalProcurementSpendInPeriod}\n\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saka-homes-report-${datePreset.toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-8 print:p-0">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 print:hidden">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs hidden sm:block">
            <SakaHomesLogo size="md" showSubtitle />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-extrabold tracking-tight text-slate-900">Inventory & Material Reports</h1>
            <p className="text-slate-500 text-xs sm:text-sm">Generate, filter, and export customized stock summaries by date range.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button 
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-[#1E1B4B] hover:bg-[#FAF8F5] transition-all shadow-2xs"
            title="Export CSV spreadsheet"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#E54818]" />
            <span>Export CSV</span>
          </button>
          <button 
            onClick={handleDownloadPDF}
            className="flex items-center gap-2 px-3.5 py-2 border border-purple-200 bg-purple-50/60 rounded-xl text-xs font-bold text-[#1E1B4B] hover:bg-purple-100/60 transition-all shadow-2xs"
            title="Download formatted PDF document with tables"
          >
            <Download className="w-4 h-4 text-[#2B1A70]" />
            <span>Export PDF Report</span>
          </button>
          <button 
            onClick={handlePrintPage}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#1E1B4B] text-white rounded-xl text-xs font-bold shadow hover:bg-purple-950 transition-all"
            title="Print report page directly"
          >
            <FileText className="w-4 h-4 text-amber-300" />
            <span>Print Page</span>
          </button>
        </div>
      </div>

      {/* Date Filter & Scope Selection Panel */}
      <div className="bg-white p-6 rounded-3xl border-2 border-[#E2E8F0] shadow-sm space-y-6 print:hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#E2E8F0] pb-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#1E293B]">
            <Filter className="w-4 h-4 text-blue-600" />
            <span>Report Filter & Date Scope</span>
          </div>

          {/* Quick Presets */}
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
                 preset === 'THIS_QUARTER' ? 'This Quarter' : 'Custom Dates'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Date Pickers & Scope Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase text-[#64748B] tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3.5 h-3.5 text-blue-600" />
              From Date
            </label>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-4 py-2.5 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white text-xs font-bold text-[#1E293B] transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase text-[#64748B] tracking-wider flex items-center gap-1">
              <CalendarIcon className="w-3.5 h-3.5 text-blue-600" />
              To Date
            </label>
            <input 
              type="date" 
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('CUSTOM');
              }}
              className="w-full px-4 py-2.5 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white text-xs font-bold text-[#1E293B] transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-black uppercase text-[#64748B] tracking-wider">
              Report View Scope
            </label>
            <select
              value={reportScope}
              onChange={(e) => setReportScope(e.target.value as ReportScope)}
              className="w-full px-4 py-2.5 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white text-xs font-bold text-[#1E293B] transition-all"
            >
              <option value="ALL">All Report Sections</option>
              <option value="MOVEMENTS">Stock Movements & Issuances Only</option>
              <option value="PURCHASE_ORDERS">Purchase Orders & Procurement Only</option>
              <option value="CATEGORY_SUMMARY">Category Inventory Summary Only</option>
            </select>
          </div>

          <div>
            {(startDate || endDate || datePreset !== 'ALL' || reportScope !== 'ALL') ? (
              <button
                onClick={() => {
                  handlePresetChange('ALL');
                  setReportScope('ALL');
                }}
                className="w-full px-4 py-2.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold hover:bg-rose-100 transition-all flex items-center justify-center gap-1"
              >
                <X className="w-4 h-4" /> Reset Filters
              </button>
            ) : (
              <div className="px-4 py-2.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold text-center border border-blue-100">
                Active: {getDateLabel()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Printable Report Header */}
      <div className="hidden print:block border-b-2 border-slate-800 pb-4 mb-6">
        <h1 className="text-2xl font-black uppercase text-slate-900">Saka Homes Limited - Materials & Inventory Report</h1>
        <p className="text-sm font-semibold text-slate-600 mt-1">Date Scope: {getDateLabel()} | Generated: {new Date().toLocaleString()}</p>
      </div>

      {/* Filtered Dynamic Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl border-2 border-[#E2E8F0] shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-[#94A3B8] tracking-widest">Total Valuation</p>
              <p className="text-xl font-black text-[#1E293B]">{formatCurrency(totals.totalValue)}</p>
            </div>
          </div>
          <p className="text-[11px] text-[#64748B]">Current inventory value in stock</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border-2 border-[#E2E8F0] shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-[#94A3B8] tracking-widest">Issued Out (Period)</p>
              <p className="text-xl font-black text-[#1E293B]">{formatNumber(totalIssuedQtyInPeriod)} units</p>
            </div>
          </div>
          <p className="text-[11px] text-[#64748B]">{filteredMovements.filter(m => m.movementType === 'ISSUED_OUT').length} issuance logs in period</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border-2 border-[#E2E8F0] shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-[#94A3B8] tracking-widest">Restocked (Period)</p>
              <p className="text-xl font-black text-[#1E293B]">{formatNumber(totalRestockedQtyInPeriod)} units</p>
            </div>
          </div>
          <p className="text-[11px] text-[#64748B]">Received from suppliers</p>
        </div>

        <div className="bg-white p-6 rounded-3xl border-2 border-[#E2E8F0] shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase text-[#94A3B8] tracking-widest">PO Spend (Period)</p>
              <p className="text-xl font-black text-blue-600">{formatCurrency(totalProcurementSpendInPeriod)}</p>
            </div>
          </div>
          <p className="text-[11px] text-[#64748B]">{filteredPOs.length} purchase orders in period</p>
        </div>
      </div>

      {/* Category Summary Section */}
      {(reportScope === 'ALL' || reportScope === 'CATEGORY_SUMMARY') && (
        <div className="bg-white rounded-3xl border-2 border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="p-8 border-b border-[#E2E8F0]">
            <h2 className="text-xl font-bold text-[#1E293B]">Stocks Summary By Category</h2>
            <p className="text-sm text-[#64748B]">Detailed breakdown of current availability metrics across all departments.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em]">Category</th>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em] text-center">Total Items</th>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em] text-center">Out of Stock</th>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em] text-center">Low Stock</th>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em] text-center">In Stock</th>
                  <th className="px-8 py-5 text-xs font-black text-[#64748B] uppercase tracking-[0.15em] text-right">Value (Approx)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {loading ? (
                  <tr><td colSpan={6} className="px-8 py-20 text-center animate-pulse text-[#94A3B8]">Compiling report data...</td></tr>
                ) : reportData.length === 0 ? (
                  <tr><td colSpan={6} className="px-8 py-20 text-center text-[#94A3B8]">No category data available.</td></tr>
                ) : reportData.map((row) => (
                  <tr key={row.category} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-8 py-6 font-bold text-[#1E293B]">{row.category}</td>
                    <td className="px-8 py-6 text-center font-mono font-bold text-blue-600">{row.totalItems}</td>
                    <td className="px-8 py-6 text-center">
                      <span className={cn("font-bold", row.outOfStock > 0 ? "text-red-500" : "text-[#94A3B8]")}>
                        {row.outOfStock}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-center">
                      <span className={cn("font-bold", row.lowStock > 0 ? "text-amber-500" : "text-[#94A3B8]")}>
                        {row.lowStock}
                      </span>
                    </td>
                    <td className="px-8 py-6 text-center font-bold text-emerald-600">{row.inStock}</td>
                    <td className="px-8 py-6 text-right font-bold text-[#1E293B]">{formatCurrency(row.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#1E293B] text-white">
                <tr>
                  <td className="px-8 py-6 font-black uppercase tracking-widest text-xs">Grand Total</td>
                  <td className="px-8 py-6 text-center font-black text-lg">{totals.totalItems}</td>
                  <td className="px-8 py-6 text-center font-black text-lg">{totals.outOfStock}</td>
                  <td className="px-8 py-6 text-center font-black text-lg">{totals.lowStock}</td>
                  <td className="px-8 py-6 text-center font-black text-lg text-emerald-400">{totals.inStock}</td>
                  <td className="px-8 py-6 text-right font-black text-lg text-blue-400">{formatCurrency(totals.totalValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Movements Report Table */}
      {(reportScope === 'ALL' || reportScope === 'MOVEMENTS') && (
        <div className="bg-white rounded-3xl border-2 border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="p-8 border-b border-[#E2E8F0] flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#1E293B]">Stock Movements & Issued Items Log</h2>
              <p className="text-sm text-[#64748B]">Showing {filteredMovements.length} records matching the period: <strong className="text-[#1E293B]">{getDateLabel()}</strong></p>
            </div>
            <div className="px-4 py-2 bg-amber-50 text-amber-800 rounded-xl font-bold text-xs w-max">
              Total Issued in Period: {formatNumber(totalIssuedQtyInPeriod)} units
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Ref Code</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Date</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Type</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Item Name</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Qty</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Stock Change</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Recipient / Site</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Issued / Logged By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-[#94A3B8]">
                      No stock movement records found for the selected date range ({getDateLabel()}).
                    </td>
                  </tr>
                ) : filteredMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F8FAFC] transition-colors text-xs">
                    <td className="px-6 py-4 font-mono font-bold text-[#1E293B]">{m.movementCode}</td>
                    <td className="px-6 py-4 text-[#64748B]">{m.date}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        m.movementType === 'ISSUED_OUT' ? "bg-amber-100 text-amber-800" :
                        m.movementType === 'RESTOCKED' ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
                      )}>
                        {m.movementType.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-bold text-[#1E293B]">{m.itemName}</td>
                    <td className="px-6 py-4 font-black">{m.quantity} {m.unitOfMeasure}</td>
                    <td className="px-6 py-4 text-[#64748B]">{m.previousStock} → <span className="font-bold text-[#1E293B]">{m.newStock}</span></td>
                    <td className="px-6 py-4 font-medium text-[#1E293B]">{m.recipient}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800">{m.issuedBy}</span>
                        {m.createdBy && (
                          <span className="text-[10px] text-slate-500 font-mono">Account: {m.createdBy}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Purchase Orders Report Table */}
      {(reportScope === 'ALL' || reportScope === 'PURCHASE_ORDERS') && (
        <div className="bg-white rounded-3xl border-2 border-[#E2E8F0] shadow-sm overflow-hidden">
          <div className="p-8 border-b border-[#E2E8F0] flex flex-col sm:flex-row justify-between sm:items-center gap-4">
            <div>
              <h2 className="text-xl font-bold text-[#1E293B]">Procurement & Purchase Orders Log</h2>
              <p className="text-sm text-[#64748B]">Showing {filteredPOs.length} purchase orders matching the period: <strong className="text-[#1E293B]">{getDateLabel()}</strong></p>
            </div>
            <div className="px-4 py-2 bg-purple-50 text-purple-800 rounded-xl font-bold text-xs w-max">
              Total PO Spend in Period: {formatCurrency(totalProcurementSpendInPeriod)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">PO Number</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Order Date</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Item Name</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Supplier</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Qty Ordered</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Total Cost</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Issued By (Account)</th>
                  <th className="px-6 py-4 text-xs font-black text-[#64748B] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {filteredPOs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-[#94A3B8]">
                      No purchase orders found for the selected date range ({getDateLabel()}).
                    </td>
                  </tr>
                ) : filteredPOs.map((po) => (
                  <tr key={po.id} className="hover:bg-[#F8FAFC] transition-colors text-xs">
                    <td className="px-6 py-4 font-mono font-bold text-blue-600">{po.poNumber}</td>
                    <td className="px-6 py-4 text-[#64748B]">{po.orderDate}</td>
                    <td className="px-6 py-4 font-bold text-[#1E293B]">{po.itemName}</td>
                    <td className="px-6 py-4 text-[#64748B]">{po.supplier}</td>
                    <td className="px-6 py-4 font-bold text-[#1E293B]">{po.qtyOrdered}</td>
                    <td className="px-6 py-4 font-bold text-blue-600">{formatCurrency(po.totalCost)}</td>
                    <td className="px-6 py-4 font-medium text-slate-800">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 font-mono text-[11px] text-slate-700">
                        <User className="w-3 h-3 text-slate-500" />
                        {po.createdBy || 'admin'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                        po.status === 'COMPLETED' ? "bg-emerald-100 text-emerald-800" :
                        po.status === 'PENDING' ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                      )}>
                        {po.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

