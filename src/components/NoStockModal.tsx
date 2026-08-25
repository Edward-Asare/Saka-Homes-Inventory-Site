import React from 'react';
import { PackageX, AlertCircle, X, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NoStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemName?: string;
  itemCode?: string;
  unitOfMeasure?: string;
  onRestock?: () => void;
}

export default function NoStockModal({
  isOpen,
  onClose,
  itemName,
  itemCode,
  unitOfMeasure = 'units',
  onRestock
}: NoStockModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print:hidden">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 overflow-hidden"
          >
            {/* Top decorative accent */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-rose-500 via-amber-500 to-rose-600" />

            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center text-center space-y-4 pt-2">
              <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-inner">
                <PackageX className="w-8 h-8" />
              </div>

              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100/80 text-rose-800 text-[11px] font-extrabold uppercase tracking-wider">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Out of Stock</span>
                </div>
                <h3 className="text-xl font-heading font-extrabold text-[#1E1B4B]">
                  No Quantity Stock Available
                </h3>
                <p className="text-slate-500 text-xs leading-relaxed max-w-xs mx-auto">
                  {itemName ? (
                    <>
                      You cannot issue out <strong className="text-slate-700">{itemName}</strong> because the current available stock is <strong className="text-rose-600 font-bold">0 {unitOfMeasure}</strong>.
                    </>
                  ) : (
                    'You cannot issue out this material item because there is zero available quantity in stock.'
                  )}
                </p>
              </div>

              <div className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-3.5 text-left text-xs space-y-2">
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>Selected Material:</span>
                  <span className="text-slate-900 font-semibold truncate max-w-[180px]">
                    {itemName || 'Selected Item'} {itemCode ? `(${itemCode})` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between font-bold text-slate-700">
                  <span>Current Available Stock:</span>
                  <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[11px] font-black">
                    0 {unitOfMeasure}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pt-1 border-t border-slate-200/60">
                  To issue this material to construction sites, you must first log a stock replenishment or receive a purchase order delivery.
                </p>
              </div>

              <div className="w-full flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                {onRestock && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onRestock();
                    }}
                    className="w-full py-3 bg-[#1E1B4B] hover:bg-purple-950 text-white rounded-xl text-xs font-bold shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-300" />
                    <span>Restock Now</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
