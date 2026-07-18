import React, { useState, useEffect } from 'react';
import { PassportInfo, FamilyMember } from '../types';
import { Save, AlertTriangle, Check, Copy } from 'lucide-react';

interface PassportDetailsProps {
  member: FamilyMember;
  onUpdatePassport: (id: string, passport: PassportInfo | undefined) => void;
}

const initPassport = (member: FamilyMember): PassportInfo => ({
  passportNumber: member.passport?.passportNumber || '',
  fullName: member.passport?.fullName || '',
  issuingCountry: member.passport?.issuingCountry || '',
  dateOfBirth: member.passport?.dateOfBirth || member.birthdate || '',
  issueDate: member.passport?.issueDate || '',
  expiryDate: member.passport?.expiryDate || '',
  notes: member.passport?.notes || '',
});

export default function PassportDetails({ member, onUpdatePassport }: PassportDetailsProps) {
  const [hasPassport, setHasPassport] = useState<boolean>(!!member.passport);
  const [passport, setPassport] = useState<PassportInfo>(() => initPassport(member));

  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Bug fix #1: re-sync when member.id changes
  useEffect(() => {
    setHasPassport(!!member.passport);
    setPassport(initPassport(member));
    setSaved(false);
  }, [member.id]);

  // Expiry Checker — Bug fix #5: was hardcoded new Date('2026-05-22')
  const checkExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return { status: 'none', daysLeft: 0, monthsLeft: 0 };
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    if (diffTime < 0) return { status: 'expired', daysLeft: 0, monthsLeft: 0 };

    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const monthsLeft = Number((diffDays / 30.4375).toFixed(1));

    if (monthsLeft <= 6) {
      return { status: 'critical', daysLeft: diffDays, monthsLeft };
    } else if (monthsLeft <= 12) {
      return { status: 'warning', daysLeft: diffDays, monthsLeft };
    }
    return { status: 'active', daysLeft: diffDays, monthsLeft };
  };

  const { status, monthsLeft } = checkExpiryStatus(passport.expiryDate);

  const handleFieldChange = (field: keyof PassportInfo, value: string) => {
    setPassport((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    if (!hasPassport) {
      onUpdatePassport(member.id, undefined);
    } else {
      if (!passport.passportNumber.trim() || !passport.fullName.trim()) return;
      onUpdatePassport(member.id, passport);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTogglePassport = (checked: boolean) => {
    setHasPassport(checked);
    setSaved(false);
  };

  const handleCopy = () => {
    if (!hasPassport) return;
    const text = `Passport Details — ${member.name}:
• Full Name: ${passport.fullName}
• Passport No: ${passport.passportNumber}
• Issuing Country: ${passport.issuingCountry}
• Date of Birth: ${passport.dateOfBirth}
• Issue Date: ${passport.issueDate}
• Expiry Date: ${passport.expiryDate}
• Notes: ${passport.notes || 'None'}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-cream-200 pb-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
            <span className="w-1.5 h-3.5 bg-ink-800 rounded-full inline-block"></span>
            Passport &amp; ID records
          </h3>
          <p className="text-[13px] text-ink-500 mt-1">Secure repository of document metadata for airport checks, flight confirmations, and emergency situations.</p>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {hasPassport && (
            <button
              type="button"
              onClick={handleCopy}
              className="btn-quiet text-sm px-4 py-3 min-h-11 active:scale-95 transition-transform duration-100"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-sage-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy metadata'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary text-sm px-4 py-3 min-h-11 active:scale-95 transition-transform duration-100"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? 'Saved!' : 'Save details'}</span>
          </button>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center space-x-2.5 p-4 rounded-2xl bg-cream-100 border border-cream-200 shadow-soft">
        <input
          type="checkbox"
          id={`hasPassport-${member.id}`}
          checked={hasPassport}
          onChange={(e) => handleTogglePassport(e.target.checked)}
          className="w-4 h-4 border-cream-300 rounded focus:ring-clay-300 focus:outline-none accent-clay-500"
        />
        <label htmlFor={`hasPassport-${member.id}`} className="text-[13px] font-semibold text-ink-700 select-none cursor-pointer">
          Track active passport details for this member
        </label>
      </div>

      {hasPassport && (
        <>
          {/* Expiry warning indicators */}
          {status === 'critical' && (
            <div className="p-4 rounded-2xl bg-honey-50 border border-honey-200 flex items-start space-x-3 shadow-soft">
              <div className="p-1.5 rounded-xl bg-honey-100 text-honey-700 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-ink-900">Urgent expiry notice</h4>
                <p className="text-[13px] text-honey-700 mt-0.5">
                  This passport expires in <strong>{monthsLeft} months</strong>. Standard international arrivals require at least <strong>6 months</strong> validity — consider starting renewal immediately.
                </p>
              </div>
            </div>
          )}

          {status === 'warning' && (
            <div className="p-4 rounded-2xl bg-honey-50 border border-honey-200/60 flex items-start space-x-3 shadow-soft">
              <div className="p-1.5 rounded-xl bg-honey-100 text-honey-700 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-ink-900">Approaching expiry</h4>
                <p className="text-[13px] text-honey-700 mt-0.5">
                  This passport expires in <strong>{monthsLeft} months</strong>. Confirm minimum validity requirements before booking flights.
                </p>
              </div>
            </div>
          )}

          {status === 'expired' && (
            <div className="p-4 rounded-2xl bg-rosa-50 border border-rosa-100 flex items-start space-x-3 shadow-soft">
              <div className="p-1.5 rounded-xl bg-rosa-100 text-rosa-700 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-ink-900">Passport expired</h4>
                <p className="text-[13px] text-rosa-700 mt-0.5">
                  This passport has already expired. Once a renewed booklet is received, update the credentials here.
                </p>
              </div>
            </div>
          )}

          {/* Expiry status chip (when active) */}
          {status === 'active' && passport.expiryDate && (
            <div className="flex items-center gap-2">
              <span className="chip bg-sage-100 text-sage-700">Valid — {monthsLeft} months remaining</span>
            </div>
          )}

          {/* Form grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="field-label">Full name as on passport</label>
              <input
                type="text"
                required
                placeholder="e.g. EMILY JANE SMITH"
                value={passport.fullName}
                onChange={(e) => handleFieldChange('fullName', e.target.value)}
                className="field uppercase placeholder:normal-case font-mono tracking-tight tabular-nums"
              />
            </div>

            <div>
              <label className="field-label">Passport number</label>
              <input
                type="text"
                required
                placeholder="e.g. US982541094"
                value={passport.passportNumber}
                onChange={(e) => handleFieldChange('passportNumber', e.target.value)}
                className="field uppercase placeholder:normal-case font-mono tracking-tight tabular-nums"
              />
            </div>

            <div>
              <label className="field-label">Issuing country</label>
              <input
                type="text"
                placeholder="e.g. United States"
                value={passport.issuingCountry}
                onChange={(e) => handleFieldChange('issuingCountry', e.target.value)}
                className="field"
              />
            </div>

            <div>
              <label className="field-label">Date of birth</label>
              <input
                type="date"
                value={passport.dateOfBirth}
                onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                className="field tabular-nums"
              />
            </div>

            <div>
              <label className="field-label">Issue date</label>
              <input
                type="date"
                value={passport.issueDate}
                onChange={(e) => handleFieldChange('issueDate', e.target.value)}
                className="field tabular-nums"
              />
            </div>

            <div>
              <label className="field-label">Expiry date</label>
              <input
                type="date"
                value={passport.expiryDate}
                onChange={(e) => handleFieldChange('expiryDate', e.target.value)}
                className="field tabular-nums"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="field-label">Notes / Global Entry numbers / visa status</label>
              <textarea
                rows={2}
                placeholder="e.g. UK Visa scan attached in files. Global Entry: #983341"
                value={passport.notes}
                onChange={(e) => handleFieldChange('notes', e.target.value)}
                className="field font-sans"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
