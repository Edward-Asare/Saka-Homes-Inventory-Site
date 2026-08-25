import React, { useState, useEffect } from 'react';
import { 
  ShoppingBag, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink
} from 'lucide-react';
import { InventoryItem, AppUser, UserRole } from '../types';
import { inventoryService } from '../services/dataService';
import SakaHomesLogo from '../components/SakaHomesLogo';

interface GuestOrdersProps {
  currentUser?: AppUser | null;
  userRole?: UserRole;
  searchQuery?: string;
  onNavigate?: (view: any) => void;
}

interface SavedOrder {
  id: string;
  itemName: string;
  itemCode?: string;
  quantity: number;
  unitOfMeasure: string;
  siteLocation: string;
  priority: 'NORMAL' | 'HIGH' | 'CRITICAL';
  notes?: string;
  sentAt: string;
  managerPhone: string;
}

export default function GuestOrders({ currentUser, userRole, searchQuery = '', onNavigate }: GuestOrdersProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [customItemName, setCustomItemName] = useState<string>('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('Units');
  const [siteLocation, setSiteLocation] = useState<string>('Main Construction Site');
  const [priority, setPriority] = useState<'NORMAL' | 'HIGH' | 'CRITICAL'>('NORMAL');
  const [notes, setNotes] = useState<string>('');

  const [copied, setCopied] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Manager contact details
  const MANAGER_PHONE_DISPLAY = '+233 545327825';
  const MANAGER_PHONE_CLEAN = '233545327825';

  // Local Order History
  const [orderHistory, setOrderHistory] = useState<SavedOrder[]>(() => {
    try {
      const stored = localStorage.getItem('saka_guest_orders_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const unsubscribe = inventoryService.subscribe((newItems) => {
      setItems(newItems);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const selectedItem = items.find(i => i.id === selectedItemId);

  // Update unit of measure when item changes
  const handleItemSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedItemId(id);
    if (id === 'CUSTOM') {
      setCustomItemName('');
    } else {
      const item = items.find(i => i.id === id);
      if (item) {
        setCustomItemName(item.itemName);
        setUnitOfMeasure(item.unitOfMeasure || 'Units');
      }
    }
  };

  const getResolvedItemName = () => {
    if (selectedItemId === 'CUSTOM') {
      return customItemName.trim();
    }
    return selectedItem?.itemName || customItemName.trim();
  };

  const generateWhatsAppMessage = () => {
    const itemName = getResolvedItemName() || '[Item Name]';
    const itemCode = selectedItem?.itemCode ? ` (Code: ${selectedItem.itemCode})` : '';
    const requesterName = currentUser?.fullName || currentUser?.username || 'Guest / Site Agent';
    const dateStr = new Date().toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const priorityLabel = priority === 'CRITICAL' 
      ? '🚨 CRITICAL (Emergency)' 
      : priority === 'HIGH' 
      ? '⚠️ HIGH URGENCY' 
      : '✅ STANDARD';

    return `*SAKA HOMES - MATERIAL REQUISITION ORDER*\n` +
      `----------------------------------------\n` +
      `📦 *Material:* ${itemName}${itemCode}\n` +
      `🔢 *Quantity Needed:* ${quantity || 0} ${unitOfMeasure}\n` +
      `📍 *Site Location:* ${siteLocation || 'General Site'}\n` +
      `⚡ *Priority:* ${priorityLabel}\n` +
      `👤 *Requested By:* ${requesterName}\n` +
      `📅 *Date & Time:* ${dateStr}\n` +
      (notes.trim() ? `📝 *Notes/Purpose:* ${notes.trim()}\n` : '') +
      `----------------------------------------\n` +
      `_Dispatched via Saka Homes Inventory Portal_`;
  };

  const handleCopyMessage = () => {
    const text = generateWhatsAppMessage();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSubmitOrder = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const resolvedName = getResolvedItemName();
    if (!resolvedName) {
      setFormError('Please select or specify the material item name.');
      return;
    }

    const numQty = Number(quantity);
    if (!numQty || numQty <= 0) {
      setFormError('Please enter a valid quantity greater than 0.');
      return;
    }

    const message = generateWhatsAppMessage();
    const whatsappUrl = `https://wa.me/${MANAGER_PHONE_CLEAN}?text=${encodeURIComponent(message)}`;

    // Save to local order history
    const newOrder: SavedOrder = {
      id: `ORD-${Date.now()}`,
      itemName: resolvedName,
      itemCode: selectedItem?.itemCode,
      quantity: numQty,
      unitOfMeasure: unitOfMeasure || 'Units',
      siteLocation: siteLocation || 'Main Construction Site',
      priority,
      notes: notes.trim(),
      sentAt: new Date().toISOString(),
      managerPhone: MANAGER_PHONE_DISPLAY
    };

    const updatedHistory = [newOrder, ...orderHistory.slice(0, 19)];
    setOrderHistory(updatedHistory);
    try {
      localStorage.setItem('saka_guest_orders_history', JSON.stringify(updatedHistory));
    } catch {}

    setSubmitSuccess(true);
    setTimeout(() => setSubmitSuccess(false), 5000);

    // Open WhatsApp in a new tab / mobile app
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleResendHistoryOrder = (order: SavedOrder) => {
    const requesterName = currentUser?.fullName || currentUser?.username || 'Guest / Site Agent';
    const dateStr = new Date().toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const priorityLabel = order.priority === 'CRITICAL' 
      ? '🚨 CRITICAL (Emergency)' 
      : order.priority === 'HIGH' 
      ? '⚠️ HIGH URGENCY' 
      : '✅ STANDARD';

    const message = `*SAKA HOMES - MATERIAL REQUISITION ORDER*\n` +
      `----------------------------------------\n` +
      `📦 *Material:* ${order.itemName}${order.itemCode ? ` (Code: ${order.itemCode})` : ''}\n` +
      `🔢 *Quantity Needed:* ${order.quantity} ${order.unitOfMeasure}\n` +
      `📍 *Site Location:* ${order.siteLocation}\n` +
      `⚡ *Priority:* ${priorityLabel}\n` +
      `👤 *Requested By:* ${requesterName}\n` +
      `📅 *Date & Time:* ${dateStr}\n` +
      (order.notes ? `📝 *Notes/Purpose:* ${order.notes}\n` : '') +
      `----------------------------------------\n` +
      `_Dispatched via Saka Homes Inventory Portal_`;

    const whatsappUrl = `https://wa.me/${MANAGER_PHONE_CLEAN}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleClearHistory = () => {
    if (confirm('Clear your sent order history?')) {
      setOrderHistory([]);
      localStorage.removeItem('saka_guest_orders_history');
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#1E1B4B] via-[#2B1A70] to-[#120B29] rounded-3xl p-8 text-white shadow-xl shadow-purple-950/10 border border-purple-900/50">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-[#E54818]/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-8 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="bg-white/10 backdrop-blur-md px-3.5 py-1.5 rounded-2xl border border-white/20 inline-block">
              <SakaHomesLogo variant="white" size="md" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-heading font-extrabold tracking-tight text-white">
              Material Orders & Requisition
            </h1>
            <p className="text-purple-200/80 text-xs sm:text-sm max-w-xl">
              Quickly issue out material requests and required quantities directly to your warehouse manager via WhatsApp.
            </p>
          </div>
        </div>
      </div>

      {/* Main Form: Order Builder */}
      <div className="max-w-4xl mx-auto bg-white rounded-3xl p-7 md:p-8 border border-slate-200/80 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-orange-50 text-[#E54818] flex items-center justify-center font-bold">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-heading font-black text-slate-900">New Material Order</h2>
                <p className="text-xs text-slate-500">Fill in the item and quantity to generate the WhatsApp dispatch message</p>
              </div>
            </div>
          </div>

          {formError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-xs font-medium">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p>{formError}</p>
            </div>
          )}

          {submitSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs font-bold">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p>WhatsApp dispatch initiated!</p>
                <p className="text-[11px] font-normal text-emerald-700">Opening WhatsApp to send order to {MANAGER_PHONE_DISPLAY}...</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitOrder} className="space-y-5">
            {/* Item Selection */}
            <div className="space-y-2">
              <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider flex items-center justify-between">
                <span>Select Material Item</span>
                <span className="text-[11px] font-normal text-slate-400">From catalog or custom</span>
              </label>
              <select
                value={selectedItemId}
                onChange={handleItemSelect}
                className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs font-bold text-slate-900"
              >
                <option value="">-- Choose from inventory catalog --</option>
                {items.map((item) => {
                  const currStock = item.currentStock !== undefined ? item.currentStock : item.reorderQty;
                  return (
                    <option key={item.id} value={item.id}>
                      {item.itemName} ({item.itemCode || 'SKU'}) • Stock: {currStock} {item.unitOfMeasure}
                    </option>
                  );
                })}
                <option value="CUSTOM">➕ Other / Custom Material (Type manually)</option>
              </select>
            </div>

            {/* Custom Item Name (if selected or empty) */}
            {(selectedItemId === 'CUSTOM' || !selectedItemId) && (
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider">
                  Material / Item Name
                </label>
                <input
                  type="text"
                  required
                  value={customItemName}
                  onChange={(e) => setCustomItemName(e.target.value)}
                  placeholder="e.g. Portland Cement 42.5R, High Tensile Iron Rods 16mm"
                  className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs font-bold text-slate-900"
                />
              </div>
            )}

            {/* Quantity and Unit of Measure */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider">
                  Quantity Needed *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 50"
                  className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-sm font-black text-slate-900"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider">
                  Unit of Measure
                </label>
                <input
                  type="text"
                  value={unitOfMeasure}
                  onChange={(e) => setUnitOfMeasure(e.target.value)}
                  placeholder="e.g. Bags, Tonnes, Pieces, Trips"
                  className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs font-bold text-slate-900"
                />
              </div>
            </div>

            {/* Site Location & Priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider">
                  Site / Delivery Location
                </label>
                <input
                  type="text"
                  value={siteLocation}
                  onChange={(e) => setSiteLocation(e.target.value)}
                  placeholder="e.g. Airport Hills Project - Block B"
                  className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs font-medium text-slate-900"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider">
                  Order Urgency
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs font-bold text-slate-900"
                >
                  <option value="NORMAL">Standard Delivery</option>
                  <option value="HIGH">High Urgency</option>
                  <option value="CRITICAL">🚨 Critical / Emergency Needed Today</option>
                </select>
              </div>
            </div>

            {/* Additional Notes */}
            <div className="space-y-2">
              <label className="text-xs font-extrabold uppercase text-[#1E1B4B] tracking-wider flex items-center justify-between">
                <span>Additional Notes / Purpose</span>
                <span className="text-[11px] font-normal text-slate-400">(Optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Needed for concrete slab pouring tomorrow at 8:00 AM. Please confirm dispatch timing."
                rows={3}
                className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-[#E54818] border-2 border-transparent focus:bg-white transition-all text-xs text-slate-900"
              />
            </div>

            {/* Submit Action Button */}
            <div className="pt-3">
              <button
                type="submit"
                className="w-full py-4 bg-[#25D366] hover:bg-[#1EBE5D] text-white rounded-2xl font-heading font-black text-sm shadow-lg shadow-emerald-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-3 group cursor-pointer"
              >
                <MessageSquare className="w-5 h-5 text-white transition-transform group-hover:scale-110" />
                <span>Send Order via WhatsApp to Manager ({MANAGER_PHONE_DISPLAY})</span>
                <ExternalLink className="w-4 h-4 opacity-80" />
              </button>
            </div>
          </form>
      </div>
    </div>
  );
}
