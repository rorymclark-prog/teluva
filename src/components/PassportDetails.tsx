import React, { useState } from 'react';
import { PassportInfo, FamilyMember } from '../types';
import { Save, AlertTriangle, Check, Calendar, ClipboardList, Shield, CreditCard, Copy } from 'lucide-react';

interface PassportDetailsProps {
  member: FamilyMember;
  onUpdatePassport: (id: string, passport: PassportInfo | undefined) => void;
}

export default function PassportDetails({ member, onUpdatePassport }: PassportDetailsProps) {
  const [hasPassport, setHasPassport] = useState<boolean>(!!member.passport);
  const [passport, setPassport] = useState<PassportInfo>({
    passportNumber: member.passport?.passportNumber || '',
    fullName: member.passport?.fullName || '',
    issuingCountry: member.passport?.issuingCountry || '',
    dateOfBirth: member.passport?.dateOfBirth || member.birthdate || '',
    issueDate: member.passport?.issueDate || '',
    expiryDate: member.passport?.expiryDate || '',
    notes: member.passport?.notes || '',
  });

  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // Expiry Checker
  const checkExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return { status: 'none', daysLeft: 0, monthsLeft: 0 };
    const today = new Date('2026-05-22'); // Fixed runtime date
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
    const text = `✈️ Passport Details - ${member.name}:
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 uppercase tracking-wider">
            <span className="w-1.5 h-3.5 bg-gray-900 rounded-full inline-block"></span>
            Passport &amp; ID Records
          </h3>
          <p className="text-xs text-gray-500 mt-1">Secure repository of document metadata for airport checks, flight confirmations, and emergency situations.</p>
        </div>
        
        <div className="flex items-center space-x-2 shrink-0">
          {hasPassport && (
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-gray-650 bg-white border border-gray-250 hover:bg-gray-50 rounded-xl transition-colors cursor-pointer shadow-xs"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied details!' : 'Copy Metadata'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-gray-950 hover:bg-black rounded-xl transition-all shadow-sm cursor-pointer"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? 'Saved!' : 'Save Details'}</span>
          </button>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center space-x-2.5 p-4 rounded-2xl bg-gray-50 border border-gray-150 shadow-xs">
        <input
          type="checkbox"
          id={`hasPassport-${member.id}`}
          checked={hasPassport}
          onChange={(e) => handleTogglePassport(e.target.checked)}
          className="w-4 h-4 text-gray-900 border-gray-300 rounded focus:ring-gray-900 focus:outline-none accent-gray-950"
        />
        <label htmlFor={`hasPassport-${member.id}`} className="text-xs font-bold text-gray-700 uppercase tracking-wide select-none cursor-pointer">
          Track Active Passport details for this member
        </label>
      </div>

      {hasPassport && (
        <>
          {/* Real-world expiry warning indicators */}
          {status === 'critical' && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-start space-x-3 shadow-xs">
              <div className="p-1.5 rounded-xl bg-amber-100/80 text-amber-800 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-amber-950 tracking-wider uppercase">Urgent Expiry Notice</h4>
                <p className="text-xs text-amber-800 mt-0.5">
                  This passport expires in <strong>{monthsLeft} months</strong>! Because standard dynamic international arrivals require at least <strong>6 months</strong> validity, consider starting the renewal process immediately.
                </p>
              </div>
            </div>
          )}

          {status === 'warning' && (
            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-150 flex items-start space-x-3 shadow-xs">
              <div className="p-1.5 rounded-xl bg-amber-100 text-amber-700 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-amber-950 tracking-wider uppercase">Approaching Expiry</h4>
                <p className="text-xs text-amber-700 mt-0.5">
                  This passport expires in <strong>{monthsLeft} months</strong>. Remember to confirm minimum validity specifications before ordering flights.
                </p>
              </div>
            </div>
          )}

          {status === 'expired' && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200/60 flex items-start space-x-3 shadow-xs">
              <div className="p-1.5 rounded-xl bg-red-100 text-red-700 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-[10px] font-bold text-red-950 tracking-wider uppercase">Passport Expired</h4>
                <p className="text-xs text-red-800 mt-0.5">
                  This passport has already expired. Once a fresh physically issued booklet is received, submit the modified credentials here.
                </p>
              </div>
            </div>
          )}

          {/* Form grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Full Name as on Passport
              </label>
              <input
                type="text"
                required
                placeholder="e.g. EMILY JANE SMITH"
                value={passport.fullName}
                onChange={(e) => handleFieldChange('fullName', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm uppercase placeholder:normal-case font-mono tracking-tight focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Passport Number
              </label>
              <input
                type="text"
                required
                placeholder="e.g. US982541094"
                value={passport.passportNumber}
                onChange={(e) => handleFieldChange('passportNumber', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm uppercase placeholder:normal-case font-mono tracking-tight focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Issuing Country
              </label>
              <input
                type="text"
                placeholder="e.g. United States"
                value={passport.issuingCountry}
                onChange={(e) => handleFieldChange('issuingCountry', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-250"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Date of Birth
              </label>
              <input
                type="date"
                value={passport.dateOfBirth}
                onChange={(e) => handleFieldChange('dateOfBirth', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-250"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Issue Date
              </label>
              <input
                type="date"
                value={passport.issueDate}
                onChange={(e) => handleFieldChange('issueDate', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-250"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-750 mb-1.5 uppercase tracking-wider">
                Expiry Date
              </label>
              <input
                type="date"
                value={passport.expiryDate}
                onChange={(e) => handleFieldChange('expiryDate', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-250"
              />
            </div>

            <div className="col-span-1 sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
                Key Notes / Global Entry Numbers / Visa Status
              </label>
              <textarea
                rows={2}
                placeholder="e.g. UK Visa scan attached in files. Global Entry: #983341"
                value={passport.notes}
                onChange={(e) => handleFieldChange('notes', e.target.value)}
                className="w-full px-3.5 py-2 border border-gray-250 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 font-sans"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
