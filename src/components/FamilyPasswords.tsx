import React, { useState, useEffect } from 'react';
import { KeyRound, Plus, Eye, EyeOff, Copy, Check, Pencil, Trash2, X, ExternalLink } from 'lucide-react';
import { PasswordEntry } from '../types';
import { loadPasswords, savePassword, deletePassword } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';

const BLANK: PasswordEntry = {
  id: '',
  service: '',
  url: '',
  username: '',
  email: '',
  password: '',
  notes: '',
  createdAt: '',
};

export default function FamilyPasswords() {
  const { isAdmin } = useFamilyCtx();
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState<PasswordEntry>(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPasswords().then(data => {
      setEntries(data);
      setLoading(false);
    });
  }, []);

  const reload = async () => {
    const data = await loadPasswords();
    setEntries(data);
  };

  const openNew = () => {
    setEditingEntry(null);
    setForm({ ...BLANK });
    setIsFormOpen(true);
  };

  const openEdit = (entry: PasswordEntry) => {
    setEditingEntry(entry);
    setForm({ ...entry });
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingEntry(null);
    setForm({ ...BLANK });
  };

  const handleSave = async () => {
    if (!form.service.trim() || !form.password.trim()) return;
    setSaving(true);
    const now = new Date().toISOString().slice(0, 10);
    const entry: PasswordEntry = {
      ...form,
      id: form.id || (Date.now().toString() + Math.floor(Math.random() * 10000)),
      createdAt: form.createdAt || now,
    };
    try {
      await savePassword(entry);
      await reload();
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this password entry?')) return;
    await deletePassword(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const toggleVisible = (id: string) => {
    setVisibleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const serviceInitial = (name: string) =>
    name.trim().charAt(0).toUpperCase() || '?';

  if (loading) {
    return (
      <div className="card p-8 text-center max-w-lg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500 mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4">
      {/* Header */}
      <div className="card p-5 sm:p-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sage-100 text-sage-700 shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink-900">Family Passwords</h2>
            <p className="text-[13px] text-ink-400 font-medium">
              {entries.length === 0
                ? 'No entries yet'
                : `${entries.length} shared password${entries.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {isAdmin && (
          <button onClick={openNew} className="btn-primary gap-1.5">
            <Plus className="w-4 h-4" />
            Add
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-cream-100 text-ink-500 text-[12px] rounded-xl px-4 py-2.5">
        These are <strong className="font-semibold text-ink-700">shared family passwords</strong> — for personal passwords use Apple Passwords or Google Passwords.
      </div>

      {/* Empty state */}
      {entries.length === 0 ? (
        <div className="card p-10 text-center">
          <KeyRound className="w-10 h-10 text-ink-200 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-ink-700 mb-1">No shared passwords yet</p>
          <p className="text-[13px] text-ink-400 max-w-xs mx-auto">
            Think Netflix, Disney+, WiFi password, school portals, the router admin login…
          </p>
          {isAdmin && (
            <button onClick={openNew} className="btn-primary mt-5 mx-auto gap-1.5">
              <Plus className="w-4 h-4" />
              Add password
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => {
            const isVisible = visibleIds.has(entry.id);
            const usernameOrEmail = entry.username || entry.email;
            const copyUid = `${entry.id}-user`;
            const copyPwId = `${entry.id}-pw`;

            return (
              <div key={entry.id} className="card p-4 sm:p-5 group">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-clay-100 text-clay-700 flex items-center justify-center text-[15px] font-bold shrink-0 select-none">
                    {serviceInitial(entry.service)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Service name + URL */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-medium text-ink-800 text-[14px] leading-tight">{entry.service}</span>
                      {entry.url && (
                        <a
                          href={entry.url.startsWith('http') ? entry.url : `https://${entry.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-300 hover:text-sage-500 transition-colors"
                          title={entry.url}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {/* Username / email */}
                    {usernameOrEmail && (
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[12px] text-ink-500 truncate">{usernameOrEmail}</span>
                        <button
                          onClick={() => handleCopy(usernameOrEmail, copyUid)}
                          className="text-ink-300 hover:text-ink-600 transition-colors shrink-0 cursor-pointer"
                          title="Copy username"
                        >
                          {copiedId === copyUid
                            ? <Check className="w-3 h-3 text-sage-500" />
                            : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    )}

                    {/* Password row */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[12px] text-ink-500 font-mono tracking-wide truncate">
                        {isVisible ? entry.password : '••••••••'}
                      </span>
                      <button
                        onClick={() => toggleVisible(entry.id)}
                        className="text-ink-300 hover:text-ink-600 transition-colors shrink-0 cursor-pointer"
                        title={isVisible ? 'Hide password' : 'Show password'}
                      >
                        {isVisible
                          ? <EyeOff className="w-3 h-3" />
                          : <Eye className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => handleCopy(entry.password, copyPwId)}
                        className="text-ink-300 hover:text-ink-600 transition-colors shrink-0 cursor-pointer"
                        title="Copy password"
                      >
                        {copiedId === copyPwId
                          ? <Check className="w-3 h-3 text-sage-500" />
                          : <Copy className="w-3 h-3" />}
                      </button>
                    </div>

                    {/* Notes */}
                    {entry.notes && (
                      <p className="text-[11px] text-ink-400 mt-1 leading-relaxed">{entry.notes}</p>
                    )}
                  </div>

                  {/* Edit button (admin only) */}
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(entry)}
                        className="p-1.5 rounded-lg text-ink-300 hover:text-ink-600 hover:bg-cream-100 transition-all cursor-pointer"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-ink-300 hover:text-rosa-500 hover:bg-cream-100 transition-all cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-sm flex items-start justify-center px-4 overflow-y-auto">
          <div className="max-w-md w-full mt-20 mb-10 bg-white rounded-2xl p-6 shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-lg font-semibold text-ink-900">
                {editingEntry ? `Edit ${editingEntry.service}` : 'New password'}
              </h3>
              <button onClick={closeForm} className="p-1.5 rounded-xl text-ink-300 hover:text-ink-700 hover:bg-cream-100 transition-all cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              {/* Service */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  Service <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  className="field w-full"
                  placeholder="e.g. Netflix, Disney+, WiFi"
                  value={form.service}
                  onChange={e => setForm(f => ({ ...f, service: e.target.value }))}
                  autoFocus
                />
              </div>

              {/* URL */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  URL <span className="text-ink-300 font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  className="field w-full"
                  placeholder="https://..."
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                />
              </div>

              {/* Username */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  Username <span className="text-ink-300 font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  className="field w-full"
                  placeholder="username or phone number"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                />
              </div>

              {/* Email */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  Email <span className="text-ink-300 font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  type="email"
                  className="field w-full"
                  placeholder="email@example.com"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>

              {/* Password */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  Password <span className="text-rosa-600">*</span>
                </label>
                <input
                  type="text"
                  className="field w-full font-mono"
                  placeholder="the password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs font-semibold text-ink-700 uppercase tracking-wide mb-1 block">
                  Notes <span className="text-ink-300 font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  className="field w-full resize-none"
                  rows={2}
                  placeholder="Any extra info…"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 mt-6">
              {/* Delete (edit mode, admin only) */}
              {editingEntry && isAdmin && (
                <button
                  onClick={() => { handleDelete(editingEntry.id); closeForm(); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium text-rosa-600 hover:bg-rosa-50 transition-colors cursor-pointer mr-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button onClick={closeForm} className="btn-quiet">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.service.trim() || !form.password.trim() || saving}
                  className="btn-primary disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
