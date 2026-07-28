import React, { useState, useEffect } from 'react';
import { FamilyMember, DigitalAccount, FinancialAccount, EducationDetails, NationalIdentifiers } from '../types';
import {
  Lock, Eye, EyeOff, Plus, Key, Check,
  School, ShieldAlert, CreditCard, Landmark
} from 'lucide-react';
import { protectSecrets, revealSecrets } from '../utils/db';
import ConfirmDeleteButton from './ConfirmDeleteButton';
import PrivacyNote from './PrivacyNote';

interface SecureSecretsProps {
  member: FamilyMember;
  onUpdateMember: (member: FamilyMember) => void;
  onOpenPrivacy?: () => void;
}

export default function SecureSecrets({ member, onUpdateMember, onOpenPrivacy }: SecureSecretsProps) {
  const [successMsg, setSuccessMsg] = useState('');

  // SSN/IDs Form States
  const [ssn, setSsn] = useState(member.identifiers?.ssn || '');
  const [dl, setDl] = useState(member.identifiers?.driversLicenseNo || '');
  const [taxId, setTaxId] = useState(member.identifiers?.taxId || '');
  const [insNo, setInsNo] = useState(member.identifiers?.insuranceNo || '');
  const [idNotes, setIdNotes] = useState(member.identifiers?.notes || '');

  // Academic/School Form States
  const [school, setSchool] = useState(member.education?.schoolName || '');
  const [grade, setGrade] = useState(member.education?.grade || '');
  const [teacher, setTeacher] = useState(member.education?.teacherName || '');
  const [contact, setContact] = useState(member.education?.teacherContact || '');
  const [room, setRoom] = useState(member.education?.roomNumber || '');
  const [schedule, setSchedule] = useState(member.education?.scheduleNotes || '');

  // Digital Logins Adder States
  const [digitalService, setDigitalService] = useState('');
  const [digitalUser, setDigitalUser] = useState('');
  const [digitalPass, setDigitalPass] = useState('');
  const [digitalUrl, setDigitalUrl] = useState('');
  const [digitalNotes, setDigitalNotes] = useState('');
  const [showAddDigital, setShowAddDigital] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<string[]>([]);
  const [revealedPw, setRevealedPw] = useState<Record<string, string>>({}); // acc.id -> decrypted password (on demand)

  // Bank Account Adder States
  const [bankName, setBankName] = useState('');
  const [bankType, setBankType] = useState('Checking');
  const [bankNumber, setBankNumber] = useState('');
  const [bankRouting, setBankRouting] = useState('');
  const [bankNotes, setBankNotes] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);

  // Bug fix #1: re-sync all form state when member.id changes
  useEffect(() => {
    setSsn(member.identifiers?.ssn || '');
    setDl(member.identifiers?.driversLicenseNo || '');
    setTaxId(member.identifiers?.taxId || '');
    setInsNo(member.identifiers?.insuranceNo || '');
    setIdNotes(member.identifiers?.notes || '');
    setSchool(member.education?.schoolName || '');
    setGrade(member.education?.grade || '');
    setTeacher(member.education?.teacherName || '');
    setContact(member.education?.teacherContact || '');
    setRoom(member.education?.roomNumber || '');
    setSchedule(member.education?.scheduleNotes || '');
    setVisiblePasswordIds([]);
    setShowAddDigital(false);
    setShowAddBank(false);
  }, [member.id]);

  // Trigger brief alert
  const triggerSuccess = (text: string) => {
    setSuccessMsg(text);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // SSN / ID Save Handler
  const handleSaveIdentifiers = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedIdentifiers: NationalIdentifiers = {
      ssn: ssn.trim(),
      driversLicenseNo: dl.trim(),
      taxId: taxId.trim(),
      insuranceNo: insNo.trim(),
      notes: idNotes.trim() || undefined
    };
    onUpdateMember({
      ...member,
      identifiers: updatedIdentifiers
    });
    triggerSuccess('SSN & identifiers saved successfully!');
  };

  // Education Save Handler
  const handleSaveEducation = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedEducation: EducationDetails = {
      schoolName: school.trim(),
      grade: grade.trim(),
      teacherName: teacher.trim(),
      teacherContact: contact.trim(),
      roomNumber: room.trim(),
      scheduleNotes: schedule.trim() || undefined
    };
    onUpdateMember({
      ...member,
      education: updatedEducation
    });
    triggerSuccess('Education and school contact logs updated!');
  };

  // Login Add Handler
  const handleAddDigitalAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!digitalService.trim() || !digitalUser.trim() || !digitalPass.trim()) return;

    // Encrypt the password before it's stored. Fails closed — if the server can't
    // be reached we abort rather than silently save plaintext.
    let encPass: string;
    try {
      [encPass] = await protectSecrets([digitalPass.trim()]);
    } catch {
      triggerSuccess("Couldn't secure the password — check your connection and try again.");
      return;
    }

    const newAccount: DigitalAccount = {
      id: 'acc-' + Date.now(),
      serviceName: digitalService.trim(),
      username: digitalUser.trim(),
      passwordPlain: encPass,
      url: digitalUrl.trim() || undefined,
      notes: digitalNotes.trim() || undefined
    };

    const currentAccounts = member.digitalAccounts || [];
    onUpdateMember({
      ...member,
      digitalAccounts: [...currentAccounts, newAccount]
    });

    setDigitalService('');
    setDigitalUser('');
    setDigitalPass('');
    setDigitalUrl('');
    setDigitalNotes('');
    setShowNewPassword(false);
    setShowAddDigital(false);
    triggerSuccess('Online login account added!');
  };

  const handleDeleteDigitalAccount = (id: string) => {
    const updated = (member.digitalAccounts || []).filter(a => a.id !== id);
    onUpdateMember({
      ...member,
      digitalAccounts: updated
    });
    triggerSuccess('Login removed.');
  };

  // Bank Add Handler
  const handleAddBankAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim() || !bankNumber.trim()) return;

    const newBank: FinancialAccount = {
      id: 'bank-' + Date.now(),
      bankName: bankName.trim(),
      accountType: bankType,
      accountNumber: bankNumber.trim(),
      routingNumber: bankRouting.trim() || undefined,
      notes: bankNotes.trim() || undefined
    };

    const currentBanks = member.financialAccounts || [];
    onUpdateMember({
      ...member,
      financialAccounts: [...currentBanks, newBank]
    });

    setBankName('');
    setBankType('Checking');
    setBankNumber('');
    setBankRouting('');
    setBankNotes('');
    setShowAddBank(false);
    triggerSuccess('Financial reference record added!');
  };

  const handleDeleteBankAccount = (id: string) => {
    const updated = (member.financialAccounts || []).filter(b => b.id !== id);
    onUpdateMember({
      ...member,
      financialAccounts: updated
    });
    triggerSuccess('Financial log removed.');
  };

  const togglePasswordVisibility = async (id: string) => {
    if (visiblePasswordIds.includes(id)) {
      setVisiblePasswordIds(visiblePasswordIds.filter(pid => pid !== id));
      return;
    }
    setVisiblePasswordIds([...visiblePasswordIds, id]);
    // Decrypt this one on demand (only what the user actually reveals).
    if (revealedPw[id] === undefined) {
      const acc = (member.digitalAccounts || []).find(a => a.id === id);
      if (acc) {
        const [plain] = await revealSecrets([acc.passwordPlain || '']);
        setRevealedPw(prev => ({ ...prev, [id]: plain }));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="card bg-gradient-to-r from-ink-900 to-ink-800 p-4 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-sage-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-white">Credentials &amp; logins</h4>
            <p className="text-xs text-ink-300 font-light mt-0.5">Manage digital accounts, identifiers, and financial records.</p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center chip bg-sage-100/10 border border-sage-500/20 text-sage-400">
          Stored locally
        </span>
      </div>

      <PrivacyNote onOpenPrivacy={onOpenPrivacy}>
        Only signed-in members of your family can see this. Login passwords are encrypted before they're stored.
      </PrivacyNote>

      {successMsg && (
        <div className="p-3 rounded-xl bg-sage-50 border border-sage-200 text-[13px] text-sage-700 flex items-center gap-2">
          <Check className="w-4 h-4 text-sage-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

        {/* LEFT COLUMN: School & SSN Info */}
        <div className="xl:col-span-5 space-y-6">

          {/* NATIONAL IDENTIFIERS & SSN FORM */}
          <section className="card p-5 space-y-4">
            <h4 className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5 pb-2 border-b border-cream-200">
              <ShieldAlert className="w-4 h-4 text-ink-500" />
              National ID &amp; SSN credentials
            </h4>

            <form onSubmit={handleSaveIdentifiers} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Social Security Number</label>
                  <input
                    type="text"
                    placeholder="e.g. XXX-XX-4920"
                    value={ssn}
                    onChange={(e) => setSsn(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="field-label">Driver&apos;s license</label>
                  <input
                    type="text"
                    placeholder="e.g. DL-EM98334"
                    value={dl}
                    onChange={(e) => setDl(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Tax ref / TIN</label>
                  <input
                    type="text"
                    placeholder="e.g. TX-EMILY-44"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="field-label">Insurance plan ID</label>
                  <input
                    type="text"
                    placeholder="e.g. BCBS-84221A"
                    value={insNo}
                    onChange={(e) => setInsNo(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Private identification notes</label>
                <textarea
                  rows={2}
                  placeholder="Original cards stored in master bedroom heavy vault."
                  value={idNotes}
                  onChange={(e) => setIdNotes(e.target.value)}
                  className="field font-sans"
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full justify-center"
              >
                Save private identifiers
              </button>
            </form>
          </section>

          {/* EDUCATION & SCHOOL DIRECTORY FORM */}
          <section className="card p-5 space-y-4">
            <h4 className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5 pb-2 border-b border-cream-200">
              <School className="w-4 h-4 text-ink-500" />
              School &amp; academic directory
            </h4>

            <form onSubmit={handleSaveEducation} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">School / nursery name</label>
                  <input
                    type="text"
                    placeholder="e.g. Lincoln Primary"
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Grade / program</label>
                  <input
                    type="text"
                    placeholder="e.g. Kindergarten"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="field-label">Teacher name / tutor</label>
                  <input
                    type="text"
                    placeholder="e.g. Mrs. Sarah Jenkins"
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Classroom</label>
                  <input
                    type="text"
                    placeholder="e.g. A-104"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    className="field font-mono tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Teacher contact (email / mobile)</label>
                <input
                  type="text"
                  placeholder="e.g. sjenkins@lincolnps.edu or +1-555-894-3220"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="field"
                />
              </div>

              <div>
                <label className="field-label">Schedule, drop-off or custom notes</label>
                <textarea
                  rows={2}
                  placeholder="Drop-off 8:15 AM, pick-up 12:30 PM. Thursday early dismissal."
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  className="field font-sans"
                />
              </div>

              <button
                type="submit"
                className="btn-primary w-full justify-center"
              >
                Save academic directory
              </button>
            </form>
          </section>

        </div>

        {/* RIGHT COLUMN: Logins and Bank Accounts */}
        <div className="xl:col-span-7 space-y-6">

          {/* SECURE ONLINE LOGINS PANEL */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cream-200">
              <h4 className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5">
                <Key className="w-4 h-4 text-ink-500" />
                Digital portals &amp; subscriptions
              </h4>
              <button
                onClick={() => setShowAddDigital(!showAddDigital)}
                className="text-[13px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer active:scale-[0.97] transition-transform"
              >
                {showAddDigital ? 'Close form' : '+ Add portal'}
              </button>
            </div>

            {showAddDigital && (
              <form onSubmit={handleAddDigitalAccount} className="bg-cream-100 p-4 rounded-xl border border-cream-200 space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Service / portal name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Disney+ Vault"
                      value={digitalService}
                      onChange={(e) => setDigitalService(e.target.value)}
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label">Access link / URL</label>
                    <input
                      type="text"
                      placeholder="e.g. disneyplus.com"
                      value={digitalUrl}
                      onChange={(e) => setDigitalUrl(e.target.value)}
                      className="field font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Email or username</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. smithkids"
                      value={digitalUser}
                      onChange={(e) => setDigitalUser(e.target.value)}
                      className="field"
                    />
                  </div>
                  {/* Bug fix #6: password field type + show/hide toggle */}
                  <div>
                    <label className="field-label">Password</label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        placeholder="SecretPass123"
                        value={digitalPass}
                        onChange={(e) => setDigitalPass(e.target.value)}
                        className="field font-mono tabular-nums pr-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-ink-400 hover:text-ink-700 active:scale-[0.97] transition-all rounded"
                        tabIndex={-1}
                        title={showNewPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="field-label">Login notes (hints / backup codes)</label>
                  <input
                    type="text"
                    placeholder="e.g. Backup codes stored on Emily's phone key log."
                    value={digitalNotes}
                    onChange={(e) => setDigitalNotes(e.target.value)}
                    className="field"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddDigital(false)}
                    className="btn-quiet text-sm px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary text-sm px-4 py-1.5"
                  >
                    Add login
                  </button>
                </div>
              </form>
            )}

            {/* List Logins */}
            <div className="space-y-3">
              {(!member.digitalAccounts || member.digitalAccounts.length === 0) ? (
                <div className="text-center py-8 bg-clay-50 rounded-2xl">
                  <Key className="w-8 h-8 text-clay-600 mx-auto mb-2" />
                  <p className="text-[13px] font-medium text-clay-700">No login accounts added yet</p>
                </div>
              ) : (
                member.digitalAccounts.map(acc => (
                  <div key={acc.id} className="card p-4 flex flex-wrap items-start justify-between gap-3 text-sm leading-normal group">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-ink-900">{acc.serviceName}</span>
                        {acc.url && (
                          <span className="text-xs font-mono tabular-nums text-ink-400">({acc.url})</span>
                        )}
                      </div>
                      <p className="text-ink-600 text-xs">
                        User: <span className="font-mono tabular-nums text-ink-800 bg-cream-100 px-1.5 py-0.5 rounded font-semibold">{acc.username}</span>
                      </p>

                      {/* Bug fix #6: masked password with per-item reveal toggle */}
                      <div className="flex items-center gap-1.5 mt-2">
                        <span className="text-xs text-ink-500">Password:</span>
                        {visiblePasswordIds.includes(acc.id) ? (
                          <span className="font-mono tabular-nums text-ink-800 text-xs bg-cream-100 px-1.5 py-0.5 rounded select-all">
                            {revealedPw[acc.id] ?? '…'}
                          </span>
                        ) : (
                          <span className="font-mono text-ink-500 text-xs tracking-widest">••••••••</span>
                        )}
                        <button
                          onClick={() => togglePasswordVisibility(acc.id)}
                          className="w-10 h-10 flex items-center justify-center text-ink-400 hover:text-ink-700 active:scale-[0.97] transition-all rounded"
                          title={visiblePasswordIds.includes(acc.id) ? 'Hide password' : 'Reveal password'}
                        >
                          {visiblePasswordIds.includes(acc.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      {acc.notes && (
                        <p className="text-xs text-ink-400 italic mt-2 bg-cream-50 p-2 rounded border border-cream-200">
                          &ldquo;{acc.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <ConfirmDeleteButton
                      onConfirm={() => handleDeleteDigitalAccount(acc.id)}
                      ariaLabel={`Remove login for ${acc.serviceName}`}
                      className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100"
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* SECURE BLOCK FOR BANK / FINANCIAL ACCOUNTS */}
          <section className="card p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-cream-200">
              <h4 className="text-[13px] font-semibold text-ink-900 flex items-center gap-1.5">
                <Landmark className="w-4 h-4 text-ink-500" />
                Financial reference &amp; utilities
              </h4>
              <button
                onClick={() => setShowAddBank(!showAddBank)}
                className="text-[13px] font-semibold text-clay-600 hover:text-clay-700 cursor-pointer active:scale-[0.97] transition-transform"
              >
                {showAddBank ? 'Close form' : '+ Add asset'}
              </button>
            </div>

            {showAddBank && (
              <form onSubmit={handleAddBankAccount} className="bg-cream-100 p-4 rounded-xl border border-cream-200 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Issuer (e.g. Chase Bank, PG&amp;E)</label>
                    <input
                      type="text"
                      required
                      placeholder="Chase Family Checking"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label">Account type</label>
                    <select
                      value={bankType}
                      onChange={(e) => setBankType(e.target.value)}
                      className="field"
                    >
                      <option value="Checking">Checking account</option>
                      <option value="Savings">Savings pool</option>
                      <option value="Utility">Utility service link</option>
                      <option value="Credit Card">Credit card line</option>
                      <option value="Other">Other reference</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Account number</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 982245104"
                      value={bankNumber}
                      onChange={(e) => setBankNumber(e.target.value)}
                      className="field font-mono tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="field-label">Routing / reference no</label>
                    <input
                      type="text"
                      placeholder="e.g. RT-021000021"
                      value={bankRouting}
                      onChange={(e) => setBankRouting(e.target.value)}
                      className="field font-mono tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">Financial note / authorized signers</label>
                  <input
                    type="text"
                    placeholder="e.g. Both parents hold signatures."
                    value={bankNotes}
                    onChange={(e) => setBankNotes(e.target.value)}
                    className="field"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddBank(false)}
                    className="btn-quiet text-sm px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary text-sm px-4 py-1.5"
                  >
                    Add asset
                  </button>
                </div>
              </form>
            )}

            {/* List Bank Reference Logs */}
            <div className="space-y-3">
              {(!member.financialAccounts || member.financialAccounts.length === 0) ? (
                <div className="text-center py-8 bg-clay-50 rounded-2xl">
                  <Landmark className="w-8 h-8 text-clay-600 mx-auto mb-2" />
                  <p className="text-[13px] font-medium text-clay-700">No reference bank accounts cataloged</p>
                </div>
              ) : (
                member.financialAccounts.map(b => (
                  <div key={b.id} className="card p-4 flex flex-wrap items-start justify-between gap-3 text-sm leading-normal group">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <CreditCard className="w-4 h-4 text-ink-400" />
                        <span className="font-semibold text-ink-900">{b.bankName}</span>
                        <span className="chip bg-cream-100 text-ink-600 text-xs">
                          {b.accountType}
                        </span>
                      </div>
                      <p className="text-ink-600 font-mono tabular-nums text-xs">
                        Account: <span className="font-bold text-ink-800 bg-cream-100 px-1.5 py-0.5 rounded select-all">{b.accountNumber}</span>
                        {b.routingNumber && (
                          <span className="ml-3 font-normal text-ink-400">
                            Routing: <span className="font-semibold text-ink-700 bg-cream-100 px-1.5 py-0.5 rounded select-all">{b.routingNumber}</span>
                          </span>
                        )}
                      </p>
                      {b.notes && (
                        <p className="text-xs text-ink-400 italic mt-2 font-light">
                          &ldquo;{b.notes}&rdquo;
                        </p>
                      )}
                    </div>

                    <ConfirmDeleteButton
                      onConfirm={() => handleDeleteBankAccount(b.id)}
                      ariaLabel={`Remove financial record for ${b.bankName}`}
                      className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100"
                    />
                  </div>
                ))
              )}
            </div>
          </section>

        </div>

      </div>
    </div>
  );
}
