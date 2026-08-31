import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Tags, 
  MoreVertical, 
  Search,
  ExternalLink,
  X,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Category, UserRole, AppUser } from '../types';
import { categoryService } from '../services/dataService';
import { cn } from '../lib/utils';

interface CategoryProps {
  searchQuery: string;
  userRole?: UserRole;
  currentUser?: AppUser;
  onAccessDenied?: (actionName?: string) => void;
}

export default function Categories({ searchQuery, userRole = 'ADMIN', currentUser, onAccessDenied }: CategoryProps) {
  const isViewer = userRole !== 'ADMIN' && userRole !== 'MANAGER';
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = categoryService.subscribe((newCats) => {
      setCategories(newCats);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const filteredCategories = categories.filter(cat => 
    cat.categoryName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    cat.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const formData = new FormData(e.currentTarget);
    const catName = (formData.get('categoryName') as string || '').trim();

    if (!catName) {
      setFormError('Category name is required.');
      return;
    }

    if (categories.some(c => c.categoryName.toLowerCase() === catName.toLowerCase())) {
      setFormError(`Category "${catName}" already exists. Please choose a different name.`);
      return;
    }

    const catData = {
      categoryName: catName,
      description: (formData.get('description') as string || '').trim(),
      primarySupplier: (formData.get('primarySupplier') as string || '').trim(),
      reviewFrequency: formData.get('reviewFrequency') as string,
      createdBy: currentUser?.username || currentUser?.fullName || 'admin',
    };

    try {
      setIsSubmitting(true);
      await categoryService.addCategory(catData);
      setIsModalOpen(false);
      setFormError(null);
    } catch (err: any) {
      console.error('Add category error:', err);
      setFormError(err.message || 'Failed to add category. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (userRole !== 'ADMIN') {
      if (onAccessDenied) onAccessDenied('permanently delete categories (Admin access required)');
      return;
    }
    const cat = categories.find(c => c.id === id);
    if (cat && cat.itemCount > 0) {
      alert("Cannot delete category with active items. Please reassign items first.");
      return;
    }
    if (confirm('Delete this category?')) {
      try {
        await categoryService.deleteCategory(id);
      } catch (error: any) {
        alert(error?.message || "Failed to delete category.");
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold tracking-tight text-[#1E1B4B]">Material Categories</h1>
          <p className="text-slate-500 text-sm mt-1">Organize and classify all inventory items for Saka Homes.</p>
        </div>
        <button 
          onClick={() => {
            if (isViewer) {
              onAccessDenied?.('create new material categories');
              return;
            }
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all"
        >
          <Plus className="w-5 h-5" />
          New Category
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
          ))
        ) : filteredCategories.length === 0 ? (
          <div className="col-span-full py-20 text-center bg-white border-2 border-dashed border-[#E2E8F0] rounded-2xl text-[#94A3B8]">
            No categories found. Create your first category to get started.
          </div>
        ) : filteredCategories.map((category) => (
          <motion.div
            key={category.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="group bg-white p-8 rounded-2xl border border-slate-200/80 hover:border-[#E54818]/30 transition-all shadow-sm hover:shadow-md"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600">
                <Tags className="w-6 h-6" />
              </div>
              <button 
                onClick={() => {
                  if (isViewer) {
                    onAccessDenied?.('delete material categories');
                    return;
                  }
                  handleDeleteCategory(category.id);
                }}
                className="text-[#94A3B8] hover:text-red-500 transition-colors"
                title="Delete Category"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-heading font-semibold text-[#1E1B4B]">{category.categoryName}</h3>
                <p className="text-sm text-[#64748B] line-clamp-2 mt-1">{category.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[#F1F5F9]">
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#94A3B8] tracking-widest mb-1">Items</p>
                  <p className="text-lg font-bold text-[#1E293B]">{category.itemCount || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-[#94A3B8] tracking-widest mb-1">Frequency</p>
                  <p className="text-sm font-semibold text-[#64748B]">{category.reviewFrequency}</p>
                </div>
              </div>

              <div className="pt-4 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase text-[#94A3B8] tracking-widest">Primary Supplier</span>
                  <span className="text-xs font-bold">{category.primarySupplier}</span>
                </div>
                <button className="p-2 bg-[#F8FAFC] rounded-xl text-blue-600 hover:bg-blue-600 hover:text-white transition-all">
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

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
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
                <h2 className="text-2xl font-heading font-semibold text-[#1E1B4B]">New Category</h2>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  disabled={isSubmitting}
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors disabled:opacity-40"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleAddCategory} className="p-8 space-y-6">
                {formError && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-800 text-sm">
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Error</p>
                      <p className="text-xs text-rose-700 mt-0.5">{formError}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Category Name</label>
                  <input 
                    name="categoryName" 
                    onChange={() => setFormError(null)}
                    required 
                    className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all text-slate-900 font-medium" 
                    placeholder="e.g. Plumbing materials" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Description</label>
                  <textarea name="description" className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all h-24" placeholder="Brief description of the category..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Primary Supplier</label>
                    <input name="primarySupplier" required className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-[#64748B] tracking-wider">Review Frequency</label>
                    <select name="reviewFrequency" className="w-full px-4 py-3 bg-[#F1F5F9] rounded-xl outline-none focus:ring-2 focus:ring-blue-400 border-2 border-transparent focus:bg-white transition-all appearance-none">
                      <option>Weekly</option>
                      <option>Monthly</option>
                      <option>Quarterly</option>
                      <option>Bi-Annually</option>
                    </select>
                  </div>
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
                    disabled={isSubmitting}
                    className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSubmitting ? 'Creating...' : 'Create Category'}
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
