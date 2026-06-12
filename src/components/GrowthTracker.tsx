import React, { useState } from 'react';
import { FamilyMember, GrowthLog } from '../types';
import { TrendingUp, Plus, Calendar, Trash2, Check, Scale, Ruler } from 'lucide-react';

interface GrowthTrackerProps {
  member: FamilyMember;
  onUpdateMember: (member: FamilyMember) => void;
}

// Bug fix #1: timezone-safe local date (avoids UTC midnight shift in Vienna)
const todayLocal = () => new Date().toLocaleDateString('en-CA');

export default function GrowthTracker({ member, onUpdateMember }: GrowthTrackerProps) {
  const [date, setDate] = useState(todayLocal());
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

  // Bug fix #2: compute numeric diffs first so sign formatting is correct
  const heightDiffNum = latestLog && earliestLog && logs.length > 1
    ? latestLog.heightCm - earliestLog.heightCm
    : null;
  const heightDiff = heightDiffNum !== null
    ? `${heightDiffNum >= 0 ? '+' : ''}${heightDiffNum.toFixed(1)}`
    : null;

  const weightDiffNum = latestLog && earliestLog && logs.length > 1 && latestLog.weightKg && earliestLog.weightKg
    ? latestLog.weightKg - earliestLog.weightKg
    : null;
  const weightDiff = weightDiffNum !== null
    ? `${weightDiffNum >= 0 ? '+' : ''}${weightDiffNum.toFixed(1)}`
    : null;

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cream-200 pb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-3.5 bg-clay-500 rounded-full inline-block"></span>
            Growth &amp; Stature Logs
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Keep a beautiful chronological growth timeline of height check-ins and pediatric weight records.</p>
        </div>

        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="btn-primary ml-auto sm:ml-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isAdding ? 'Close logger' : 'Log new metrics'}</span>
        </button>
      </div>

      {/* Success alert */}
      {success && (
        <div className="p-3.5 rounded-xl bg-sage-100 border border-sage-200 text-[13px] text-sage-700 flex items-center gap-2">
          <Check className="w-4 h-4 text-sage-500" />
          <span>Growth log recorded successfully. Baseline clothes values updated!</span>
        </div>
      )}

      {/* Add New Log Form */}
      {isAdding && (
        <form onSubmit={handleAddLog} className="bg-cream-100 p-5 rounded-2xl border border-cream-300 shadow-soft space-y-4">
          <h4 className="text-[13px] font-semibold text-ink-600 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-clay-500" />
            New growth entry
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="field-label">Check-in date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="field font-mono"
              />
            </div>

            <div>
              <label className="field-label">Height (cm)</label>
              <input
                type="number"
                step="0.1"
                required
                placeholder="e.g. 116.5"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label className="field-label">Weight (kg) — optional</label>
              <input
                type="number"
                step="0.1"
                placeholder="e.g. 21.4"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="field"
              />
            </div>
          </div>

          <div>
            <label className="field-label">General notes (e.g. 6-year pediatric checkup, healthy development)</label>
            <input
              type="text"
              placeholder="e.g. Measured at school. Clothing size M fits perfectly now."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field font-sans"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="btn-quiet"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
            >
              Commit entry
            </button>
          </div>
        </form>
      )}

      {/* Stats Quick Insights Box */}
      {logs.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5 flex items-center justify-between">
            <div>
              <p className="section-label mb-1">Current height</p>
              <p className="text-xl font-light text-ink-900">
                {latestLog ? `${latestLog.heightCm} cm` : '—'}
              </p>
            </div>
            <div className="p-3 bg-cream-100 rounded-xl text-ink-400">
              <Ruler className="w-4 h-4" />
            </div>
          </div>

          <div className="card p-5 flex items-center justify-between">
            <div>
              <p className="section-label mb-1">Current weight</p>
              <p className="text-xl font-light text-ink-900">
                {latestLog && latestLog.weightKg ? `${latestLog.weightKg} kg` : '—'}
              </p>
            </div>
            <div className="p-3 bg-cream-100 rounded-xl text-ink-400">
              <Scale className="w-4 h-4" />
            </div>
          </div>

          <div className="card p-5 flex items-center justify-between">
            <div>
              <p className="section-label mb-1">Growth index</p>
              <p className="text-md font-semibold text-sage-600">
                {heightDiff ? `${heightDiff} cm cumulative` : 'First raw log'}
              </p>
              {weightDiff && weightDiffNum !== 0 && (
                <span className="text-[11px] text-ink-400 block mt-0.5">
                  Weight change: {weightDiff} kg
                </span>
              )}
            </div>
            <div className="p-3 bg-sage-100 rounded-xl text-sage-500">
              <TrendingUp className="w-4 h-4 animate-pulse" />
            </div>
          </div>
        </section>
      )}

      {/* Logs Table / Timeline */}
      <div className="card overflow-hidden">
        {logs.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Calendar className="w-8 h-8 text-cream-400 mx-auto mb-2" />
            <p className="text-[13px] font-semibold text-ink-800">No growth logs yet</p>
            <p className="text-[13px] text-ink-400 mt-0.5">Click &ldquo;Log new metrics&rdquo; above to record height and weight checkpoints.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-cream-100 border-b border-cream-200 text-[11px] font-semibold text-ink-500">
                  <th className="p-4">Date checked</th>
                  <th className="p-4">Height (cm)</th>
                  <th className="p-4">Weight (kg)</th>
                  <th className="p-4 hidden md:table-cell">Notes / checkup narrative</th>
                  <th className="p-4 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-200 font-sans">
                {sortedLogs.map((log, index) => {
                  // Bug fix #2: per-row diffs with correct sign formatting
                  const rowHeightDiffNum = index < sortedLogs.length - 1
                    ? log.heightCm - sortedLogs[index + 1].heightCm
                    : null;
                  const rowHeightDiff = rowHeightDiffNum !== null
                    ? `${rowHeightDiffNum >= 0 ? '+' : ''}${rowHeightDiffNum.toFixed(1)}`
                    : null;

                  const rowWeightDiffNum = log.weightKg && index < sortedLogs.length - 1 && sortedLogs[index + 1].weightKg
                    ? log.weightKg - sortedLogs[index + 1].weightKg
                    : null;
                  const rowWeightDiff = rowWeightDiffNum !== null
                    ? `${rowWeightDiffNum >= 0 ? '+' : ''}${rowWeightDiffNum.toFixed(1)}`
                    : null;

                  return (
                    <tr key={log.id} className="hover:bg-cream-50/50 transition-colors">
                      <td className="p-4 font-mono text-ink-600 font-semibold">{log.date}</td>
                      <td className="p-4 text-ink-900 font-medium">
                        {log.heightCm} cm
                        {rowHeightDiff !== null && (
                          <span className="text-[10px] text-sage-600 ml-2 font-semibold">
                            ({rowHeightDiff} cm)
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-ink-700">
                        {log.weightKg ? `${log.weightKg} kg` : '—'}
                        {rowWeightDiff !== null && rowWeightDiffNum !== 0 ? (
                          <span className={`text-[10px] ml-1.5 ${
                            (rowWeightDiffNum ?? 0) >= 0 ? 'text-sage-600' : 'text-honey-700'
                          }`}>
                            ({rowWeightDiff} kg)
                          </span>
                        ) : null}
                      </td>
                      <td className="p-4 text-ink-400 hidden md:table-cell max-w-xs truncate italic">
                        {log.notes || <span className="text-cream-400">—</span>}
                      </td>
                      <td className="p-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteLog(log.id)}
                          className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-xl transition-colors cursor-pointer"
                          title="Remove entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
