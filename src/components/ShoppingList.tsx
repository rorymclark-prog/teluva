import React, { useState, useEffect, useRef } from 'react';
import { ShoppingCart, Plus, X, Check, Trash2 } from 'lucide-react';
import { ShoppingItem } from '../types';
import { loadShopping, saveShopping } from '../utils/db';

export default function ShoppingList() {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadShopping().then(data => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  const persist = async (updated: ShoppingItem[]) => {
    setItems(updated);
    await saveShopping(updated);
  };

  const addItem = async () => {
    const name = newItem.trim();
    if (!name) return;
    const item: ShoppingItem = {
      id: Date.now().toString() + Math.floor(Math.random() * 1000),
      name,
      checked: false,
      addedAt: new Date().toISOString().slice(0, 10),
    };
    await persist([...items, item]);
    setNewItem('');
    inputRef.current?.focus();
  };

  const toggleItem = async (id: string) => {
    await persist(items.map(i => i.id === id ? { ...i, checked: !i.checked } : i));
  };

  const deleteItem = async (id: string) => {
    await persist(items.filter(i => i.id !== id));
  };

  const clearDone = async () => {
    await persist(items.filter(i => !i.checked));
  };

  const unchecked = items.filter(i => !i.checked);
  const checked = items.filter(i => i.checked);

  if (loading) {
    return (
      <div className="card p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-cream-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sage-100 text-sage-700 shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-ink-900">Shopping list</h2>
              <p className="text-[13px] text-ink-400 font-medium">
                {unchecked.length > 0
                  ? `${unchecked.length} item${unchecked.length !== 1 ? 's' : ''} to get`
                  : items.length > 0 ? 'All done!' : 'Nothing on the list yet'}
              </p>
            </div>
          </div>
          {checked.length > 0 && (
            <button onClick={clearDone} className="btn-quiet text-xs px-3 py-2">
              <Trash2 className="w-3.5 h-3.5" />
              Clear done
            </button>
          )}
        </div>

        {/* Add item */}
        <div className="p-4 sm:p-5 border-b border-cream-200 bg-cream-50/60">
          <form onSubmit={(e) => { e.preventDefault(); addItem(); }} className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Add an item…"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="field flex-1"
            />
            <button type="submit" disabled={!newItem.trim()} className="btn-primary px-4 disabled:opacity-40">
              <Plus className="w-4 h-4" />
            </button>
          </form>
          <p className="text-[11px] text-ink-400 mt-2">
            Tip: ask the assistant — "add milk, eggs and bread to the shopping list"
          </p>
        </div>

        {/* Items */}
        <div className="p-4 sm:p-5">
          {items.length === 0 ? (
            <div className="text-center py-10">
              <ShoppingCart className="w-10 h-10 text-ink-200 mx-auto mb-3" />
              <p className="text-[13px] text-ink-400">Add items above or ask the assistant.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Unchecked */}
              {unchecked.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors">
                  <button
                    onClick={() => toggleItem(item.id)}
                    className="w-5 h-5 rounded-full border-2 border-cream-400 shrink-0 flex items-center justify-center hover:border-sage-500 transition-colors cursor-pointer"
                  />
                  <span className="flex-1 text-[14px] text-ink-800 font-medium leading-tight">{item.name}</span>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-ink-300 hover:text-rosa-500 transition-all cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {/* Divider + checked */}
              {checked.length > 0 && (
                <>
                  {unchecked.length > 0 && <div className="border-t border-cream-200 my-3" />}
                  <p className="text-[11px] font-bold text-ink-400 px-2 mb-1">Done</p>
                  {checked.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-cream-50 group transition-colors">
                      <button
                        onClick={() => toggleItem(item.id)}
                        className="w-5 h-5 rounded-full border-2 border-sage-400 bg-sage-400 shrink-0 flex items-center justify-center hover:bg-sage-500 transition-colors cursor-pointer"
                      >
                        <Check className="w-3 h-3 text-white" />
                      </button>
                      <span className="flex-1 text-[14px] text-ink-400 font-medium line-through leading-tight">{item.name}</span>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-ink-300 hover:text-rosa-500 transition-all cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
