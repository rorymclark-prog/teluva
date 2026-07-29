import React, { useEffect, useRef, useState } from 'react';
import { FamilyMember, GrowthLog, IdCountry } from '../types';
import { TrendingUp, Plus, Calendar, Trash2, Check, Scale, Ruler, Camera, RefreshCcw, AlertCircle } from 'lucide-react';
import { loadSettings } from '../utils/db';
import { compressImageToAvatar } from '../utils/imageCompress';
import {
  toCanonicalHeightCm, toCanonicalWeightKg, fromCanonicalHeightCm, fromCanonicalWeightKg,
  unitSystemForCountry, heightUnitFor, weightUnitFor, HeightUnit, WeightUnit,
} from '../utils/measurementUnits';
import { getUnitSystemOverride, setUnitSystemOverride } from '../utils/unitPreference';
import { measureFromPhoto, isInterpolatedSource, MeasureResult } from '../utils/measurePhoto';
import EmptyState from './EmptyState';

interface GrowthTrackerProps {
  member: FamilyMember;
  onUpdateMember: (member: FamilyMember) => void;
}

// Bug fix #1: timezone-safe local date (avoids UTC midnight shift in Vienna)
const todayLocal = () => new Date().toLocaleDateString('en-CA');

export default function GrowthTracker({ member, onUpdateMember }: GrowthTrackerProps) {
  const [date, setDate] = useState(todayLocal());
  const [height, setHeight] = useState('');   // in `heightUnit`, NOT necessarily cm
  const [weight, setWeight] = useState('');   // in `weightUnit`, NOT necessarily kg
  const [notes, setNotes] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [success, setSuccess] = useState(false);

  // This app's one existing locale signal (HubSettings.country, set in
  // FamilySettings.tsx) drives the default unit system — self-loaded here the
  // same way NeedsAttention.tsx self-loads its own extra data, so no new prop
  // is needed on this component. A per-device override (localStorage, not
  // synced) lets e.g. a US grandparent read/type in their own units without
  // changing what the family itself sees.
  const [country, setCountry] = useState<IdCountry | undefined>(undefined);
  const [override, setOverride] = useState(() => getUnitSystemOverride());
  useEffect(() => {
    let cancelled = false;
    loadSettings().then((s) => { if (!cancelled) setCountry(s?.country); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const unitSystem = override ?? unitSystemForCountry(country);
  const heightUnit: HeightUnit = heightUnitFor(unitSystem);
  const weightUnit: WeightUnit = weightUnitFor(unitSystem);
  const toggleUnitOverride = () => {
    const next = unitSystem === 'imperial' ? 'metric' : 'imperial';
    setUnitSystemOverride(next);
    setOverride(next);
  };

  // "Measure from a photo" — AI reading state. Nothing here is ever saved
  // automatically: a reading only pre-fills the height/weight fields above,
  // which still require the existing "Commit entry" tap to persist.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<MeasureResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [checkHeight, setCheckHeight] = useState(''); // editable pending value for a ruler/growth-chart height reading, in `heightUnit`
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aiResult?.readings.heightCm != null && isInterpolatedSource(aiResult.sourceKind)) {
      setCheckHeight(String(fromCanonicalHeightCm(aiResult.readings.heightCm, heightUnit)));
    }
  }, [aiResult, heightUnit]);

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setAiError(null);
    setAiResult(null);
    setAiBusy(true);
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read the photo file.'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressImageToAvatar(rawDataUrl, 1024, 0.85);
      const result = await measureFromPhoto(compressed);
      setAiResult(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Something went wrong reading the photo.');
    } finally {
      setAiBusy(false);
    }
  };

  // Scale/label readings are reliable enough for a one-tap accept (still
  // requires the human to tap "Commit entry" afterwards — nothing is saved
  // here).
  const applyReliableReading = () => {
    if (!aiResult) return;
    const { heightCm, weightKg } = aiResult.readings;
    if (heightCm != null) setHeight(String(fromCanonicalHeightCm(heightCm, heightUnit)));
    if (weightKg != null) setWeight(String(fromCanonicalWeightKg(weightKg, weightUnit)));
    setIsAdding(true);
    setAiResult(null);
  };

  // Ruler/growth-chart readings are an interpolated guess, not a printed
  // digit — insert whatever the parent has confirmed/edited in `checkHeight`,
  // never the raw AI value blindly.
  const insertCheckedHeight = () => {
    if (!checkHeight) return;
    setHeight(checkHeight);
    setIsAdding(true);
    setAiResult(null);
  };

  const logs = member.growthHistory || [];

  const handleAddLog = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedHeight = parseFloat(height);
    const parsedWeight = parseFloat(weight);
    const heightCm = toCanonicalHeightCm(parsedHeight, heightUnit);
    if (heightCm === null) return;
    const weightKg = toCanonicalWeightKg(parsedWeight, weightUnit);

    const newLog: GrowthLog = {
      id: 'glog-' + Date.now(),
      date,
      heightCm,
      weightKg: weightKg ?? 0,
      notes: notes.trim() || undefined,
    };

    // Sort logs chronologically
    const updatedHistory = [...logs, newLog].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Also update current active clothing heights/weights for consistency —
    // ClothingSizes.heightCm/weightKg are canonical metric, same as GrowthLog.
    const updatedClothing = {
      ...member.clothingSizes,
      heightCm: String(heightCm),
      weightKg: weightKg !== null ? String(weightKg) : member.clothingSizes.weightKg,
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

  // Computations — all diffs are computed in CANONICAL cm/kg (exact), then
  // converted to the display unit only at the point of formatting. Unit
  // conversion is linear (no offset) for both cm<->in and kg<->lb, so
  // converting a delta is valid the same way as converting an absolute value.
  const sortedLogs = [...logs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Latest first
  const latestLog = sortedLogs[0];
  const earliestLog = sortedLogs[sortedLogs.length - 1];

  // Bug fix #2: compute numeric diffs first so sign formatting is correct
  const heightDiffNum = latestLog && earliestLog && logs.length > 1
    ? latestLog.heightCm - earliestLog.heightCm
    : null;
  const heightDiff = heightDiffNum !== null
    ? `${heightDiffNum >= 0 ? '+' : ''}${fromCanonicalHeightCm(heightDiffNum, heightUnit).toFixed(1)}`
    : null;

  const weightDiffNum = latestLog && earliestLog && logs.length > 1 && latestLog.weightKg && earliestLog.weightKg
    ? latestLog.weightKg - earliestLog.weightKg
    : null;
  const weightDiff = weightDiffNum !== null
    ? `${weightDiffNum >= 0 ? '+' : ''}${fromCanonicalWeightKg(weightDiffNum, weightUnit).toFixed(1)}`
    : null;

  const heightPlaceholder = heightUnit === 'in' ? 'e.g. 45.9' : 'e.g. 116.5';
  const weightPlaceholder = weightUnit === 'lb' ? 'e.g. 47.2' : 'e.g. 21.4';

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
          <button
            type="button"
            onClick={toggleUnitOverride}
            className="text-[11.5px] text-ink-400 hover:text-ink-700 underline underline-offset-2 mt-1 cursor-pointer"
          >
            Showing {heightUnit === 'in' ? 'imperial (in / lb)' : 'metric (cm / kg)'} — switch to {unitSystem === 'imperial' ? 'metric' : 'imperial'}
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto sm:ml-0 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={aiBusy}
            className="btn-quiet disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Measure from photo</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAdding(!isAdding)}
            className="btn-primary"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAdding ? 'Close logger' : 'Log new metrics'}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoSelected}
        />
      </div>

      {/* AI photo-reading status */}
      {aiBusy && (
        <div className="p-3.5 rounded-xl bg-cream-100 border border-cream-300 text-[13px] text-ink-600 flex items-center gap-2">
          <RefreshCcw className="w-4 h-4 animate-spin text-clay-500" />
          <span>Reading the photo…</span>
        </div>
      )}

      {aiError && (
        <div className="p-3.5 rounded-xl bg-rosa-50 border border-rosa-100 text-[13px] text-rosa-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rosa-500" />
          <span>{aiError}</span>
        </div>
      )}

      {aiResult && (() => {
        const { heightCm, weightKg } = aiResult.readings;
        const nothingRead = heightCm == null && weightKg == null;
        const interpolated = isInterpolatedSource(aiResult.sourceKind);
        return (
          <div className={`p-3.5 rounded-xl space-y-2.5 bg-honey-50 border ${interpolated ? 'border-2 border-honey-500' : 'border-honey-200'}`}>
            <p className="text-[13px] text-ink-700"><span className="font-semibold">What I saw:</span> {aiResult.sawText || aiResult.note || 'Nothing measurable found.'}</p>
            {nothingRead ? (
              <p className="text-[12.5px] text-ink-500">{aiResult.note || "Couldn't get a confident reading — please enter the values by hand."}</p>
            ) : interpolated ? (
              <div className="space-y-2">
                <p className="text-[12.5px] font-semibold text-honey-900">
                  Read from a ruler/growth chart — this is an estimate. Please check it against the wall before saving.
                </p>
                {heightCm != null && (
                  <div className="flex items-center gap-2">
                    <label className="text-[12.5px] font-semibold text-ink-600 shrink-0">Height ({heightUnit}) — check &amp; edit:</label>
                    <input
                      type="number"
                      step="0.1"
                      value={checkHeight}
                      onChange={(e) => setCheckHeight(e.target.value)}
                      className="field w-28"
                    />
                  </div>
                )}
                <div className="flex gap-2 pt-0.5">
                  <button type="button" onClick={insertCheckedHeight} className="btn-primary text-[12.5px] px-3 py-1.5">
                    Insert into form
                  </button>
                  <button type="button" onClick={() => setAiResult(null)} className="btn-quiet text-[12.5px] px-3 py-1.5">
                    Discard
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 text-[12.5px]">
                  {heightCm != null && (
                    <span className="chip bg-white border border-honey-200 text-ink-700">
                      Height: {fromCanonicalHeightCm(heightCm, heightUnit)} {heightUnit}
                    </span>
                  )}
                  {weightKg != null && (
                    <span className="chip bg-white border border-honey-200 text-ink-700">
                      Weight: {fromCanonicalWeightKg(weightKg, weightUnit)} {weightUnit}
                    </span>
                  )}
                </div>
                {aiResult.confidence === 'medium' && (
                  <p className="text-[11.5px] text-honey-700 italic">Medium confidence — double-check before saving.</p>
                )}
                <div className="flex gap-2 pt-0.5">
                  <button type="button" onClick={applyReliableReading} className="btn-primary text-[12.5px] px-3 py-1.5">
                    <Check className="w-3.5 h-3.5" /> Use these
                  </button>
                  <button type="button" onClick={() => setAiResult(null)} className="btn-quiet text-[12.5px] px-3 py-1.5">
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

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
              <label className="field-label">Height ({heightUnit})</label>
              <input
                type="number"
                step="0.1"
                required
                placeholder={heightPlaceholder}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label className="field-label">Weight ({weightUnit}) — optional</label>
              <input
                type="number"
                step="0.1"
                placeholder={weightPlaceholder}
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
              <p className="text-xl font-light text-ink-900 tabular-nums">
                {latestLog ? `${fromCanonicalHeightCm(latestLog.heightCm, heightUnit)} ${heightUnit}` : '—'}
              </p>
            </div>
            <div className="p-3 bg-cream-100 rounded-xl text-ink-400">
              <Ruler className="w-4 h-4" />
            </div>
          </div>

          <div className="card p-5 flex items-center justify-between">
            <div>
              <p className="section-label mb-1">Current weight</p>
              <p className="text-xl font-light text-ink-900 tabular-nums">
                {latestLog && latestLog.weightKg ? `${fromCanonicalWeightKg(latestLog.weightKg, weightUnit)} ${weightUnit}` : '—'}
              </p>
            </div>
            <div className="p-3 bg-cream-100 rounded-xl text-ink-400">
              <Scale className="w-4 h-4" />
            </div>
          </div>

          <div className="card p-5 flex items-center justify-between">
            <div>
              <p className="section-label mb-1">Growth index</p>
              <p className="text-md font-semibold text-sage-600 tabular-nums">
                {heightDiff ? `${heightDiff} ${heightUnit} cumulative` : 'First raw log'}
              </p>
              {weightDiff && weightDiffNum !== 0 && (
                <span className="text-[11px] text-ink-400 block mt-0.5 tabular-nums">
                  Weight change: {weightDiff} {weightUnit}
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
          <EmptyState
            icon={Calendar}
            title="No growth logs yet"
            description={<>Click &ldquo;Log new metrics&rdquo; above to record height and weight checkpoints.</>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-cream-100 border-b border-cream-200 text-[11px] font-semibold text-ink-500">
                  <th className="p-4">Date checked</th>
                  <th className="p-4">Height ({heightUnit})</th>
                  <th className="p-4">Weight ({weightUnit})</th>
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
                    ? `${rowHeightDiffNum >= 0 ? '+' : ''}${fromCanonicalHeightCm(rowHeightDiffNum, heightUnit).toFixed(1)}`
                    : null;

                  const rowWeightDiffNum = log.weightKg && index < sortedLogs.length - 1 && sortedLogs[index + 1].weightKg
                    ? log.weightKg - sortedLogs[index + 1].weightKg
                    : null;
                  const rowWeightDiff = rowWeightDiffNum !== null
                    ? `${rowWeightDiffNum >= 0 ? '+' : ''}${fromCanonicalWeightKg(rowWeightDiffNum, weightUnit).toFixed(1)}`
                    : null;

                  return (
                    <tr key={log.id} className="hover:bg-cream-50/50 transition-colors">
                      <td className="p-4 font-mono text-ink-600 font-semibold tabular-nums">{log.date}</td>
                      <td className="p-4 text-ink-900 font-medium tabular-nums">
                        {fromCanonicalHeightCm(log.heightCm, heightUnit)} {heightUnit}
                        {rowHeightDiff !== null && (
                          <span className="text-[10px] text-sage-600 ml-2 font-semibold">
                            ({rowHeightDiff} {heightUnit})
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-ink-700 tabular-nums">
                        {log.weightKg ? `${fromCanonicalWeightKg(log.weightKg, weightUnit)} ${weightUnit}` : '—'}
                        {rowWeightDiff !== null && rowWeightDiffNum !== 0 ? (
                          <span className={`text-[10px] ml-1.5 ${
                            (rowWeightDiffNum ?? 0) >= 0 ? 'text-sage-600' : 'text-honey-700'
                          }`}>
                            ({rowWeightDiff} {weightUnit})
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
