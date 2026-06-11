import React, { useState } from 'react';
import { FamilyMember, GrowthLog } from '../types';
import { TrendingUp, Plus, Calendar, Trash2, Check, Scale, Ruler } from 'lucide-react';

interface GrowthTrackerProps {
  member: FamilyMember;
  onUpdateMember: (member: FamilyMember) => void;
}

export default function GrowthTracker({ member, onUpdateMember }: GrowthTrackerProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [success, setSuccess] = useState(false);

  const logs = member.growthHistory || [];

  const handleAddLog = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedHeight = parseFloat(height);
    const parsedWeight = parseFloat(weight);

    if (isNaN(parsedHeight) || parsedHeight <= 0) return;
    
    const newLog: GrowthLog = {
      id: 'glog-' + Date.now(),
      date,
      heightCm: parsedHeight,
      weightKg: isNaN(parsedWeight) ? 0 : parsedWeight,
      notes: notes.trim() || undefined,
    };

    // Sort logs chronologically
    const updatedHistory = [...logs, newLog].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Also update current active clothing heights/weights for consistency
    const updatedClothing = {
      ...member.clothingSizes,
      heightCm: height,
      weightKg: weight || member.clothingSizes.weightKg,
      lastUpdated: date
    };

    // Trigger parent save
    onUpdateMember({
      ...member,
      clothingSizes: updatedClothing,
      growthHistory: updatedHistory,
    });

    // Reset Form
    setHeight('');
    setWeight('');
    setNotes('');
    setIsAdding(false);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
  };

  const handleDeleteLog = (logId: string) => {
    const updated = logs.filter(l => l.id !== logId);
    onUpdateMember({
      ...member,
      growthHistory: updated
    });
  };

  // Computations
  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Latest first
  const latestLog = sortedLogs[0];
  const earliestLog = sortedLogs[sortedLogs.length - 1];

  const heightDiff = latestLog && earliestLog && logs.length > 1
    ? (latestLog.heightCm - earliestLog.heightCm).toFixed(1)
    : null;

  const weightDiff = latestLog && earliestLog && logs.length > 1 && latestLog.weightKg && earliestLog.weightKg
    ? (latestLog.weightKg - earliestLog.weightKg).toFixed(1)
    : null;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-3.5 bg-gray-900 rounded-full inline-block"></span>
            Growth &amp; Stature Logs
          </h3>
          <p className="text-xs text-gray-500 mt-1">Keep a beautiful chronological growth timeline of height check-ins and pediatric weight records.</p>
        </div>

        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-gray-950 hover:bg-black rounded-xl transition-all shadow-sm cursor-pointer ml-auto sm:ml-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isAdding ? 'Close logger' : 'Log New Metrics'}</span>
        </button>
      </div>

      {/* Success alert */}
      {success && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-150 text-xs text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Growth log recorded successfully. Baseline clothes values updated!</span>
        </div>
      )}

      {/* Add New Log Form */}
      {isAdding && (
        <form onSubmit={handleAddLog} className="bg-gray-50 p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
          <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            New Growth Entry
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Check-in Date
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Height (cm)
              </label>
              <input
                type="number"
                step="0.1"
                required
                placeholder="e.g. 116.5"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Weight (kg) — Optional
              </label>
              <input
                type="number"
                step="0.1"
                placeholder="e.g. 21.4"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
              General Notes (e.g. 6-Year Pediatric Checkup, healthy development, size transition)
            </label>
            <input
              type="text"
              placeholder="e.g. Measured at school. Clothing size M fits perfectly now."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 bg-white border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 font-sans"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 border border-gray-200 text-gray-500 rounded-xl text-xs font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-gray-950 hover:bg-black text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
            >
              Commit Entry
            </button>
          </div>
        </form>
      )}

      {/* Stats Quick Insights Box */}
      {logs.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1">Current Height</p>
              <p className="text-xl font-light text-gray-900">
                {latestLog ? `${latestLog.heightCm} cm` : '—'}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl text-gray-400">
              <Ruler className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1">Current Weight</p>
              <p className="text-xl font-light text-gray-900">
                {latestLog && latestLog.weightKg ? `${latestLog.weightKg} kg` : '—'}
              </p>
            </div>
            <div className="p-3 bg-gray-50 rounded-xl text-gray-400">
              <Scale className="w-4 h-4" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-450 font-bold mb-1">Growth Index</p>
              <p className="text-md font-semibold text-emerald-700">
                {heightDiff ? `+${heightDiff} cm cumulative` : 'First raw log'}
              </p>
              {weightDiff && parseFloat(weightDiff) !== 0 && (
                <span className="text-[9px] text-gray-400 block mt-0.5">
                  Weight change: {parseFloat(weightDiff) > 0 ? '+' : ''}{weightDiff} kg
                </span>
              )}
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
              <TrendingUp className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        </section>
      )}

      {/* Logs Table / Timeline */}
      <div className="bg-white border border-gray-150 rounded-2xl overflow-hidden shadow-xs">
        {logs.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-gray-800">No Growth Logs Yet</p>
            <p className="text-[11px] text-gray-400 mt-0.5">Click &ldquo;Log New Metrics&rdquo; above to record height and weight checkpoints.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  <th className="p-4">Date Checked</th>
                  <th className="p-4">Height (cm)</th>
                  <th className="p-4">Weight (kg)</th>
                  <th className="p-4 hidden md:table-cell">Notes / Checkup Narrative</th>
                  <th className="p-4 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-sans">
                {sortedLogs.map((log, index) => (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-mono text-gray-600 font-semibold">{log.date}</td>
                    <td className="p-4 text-gray-900 font-medium">
                      {log.heightCm} cm
                      {index < sortedLogs.length - 1 && (
                        <span className="text-[10px] text-emerald-600 ml-2 font-semibold">
                          (+{(log.heightCm - sortedLogs[index + 1].heightCm).toFixed(1)} cm)
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-gray-700">
                      {log.weightKg ? `${log.weightKg} kg` : '—'}
                      {log.weightKg && index < sortedLogs.length - 1 && sortedLogs[index + 1].weightKg ? (
                        <span className={`text-[10px] ml-1.5 ${
                          (log.weightKg - sortedLogs[index + 1].weightKg) >= 0 ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          ({(log.weightKg - sortedLogs[index + 1].weightKg) >= 0 ? '+' : ''}
                          {(log.weightKg - sortedLogs[index + 1].weightKg).toFixed(1)} kg)
                        </span>
                      ) : null}
                    </td>
                    <td className="p-4 text-gray-400 hidden md:table-cell max-w-xs truncate italic">
                      {log.notes || <span className="text-gray-200">—</span>}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteLog(log.id)}
                        className="p-1.5 text-gray-400 hover:text-red-650 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer"
                        title="Remove Entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
