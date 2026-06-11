import React, { useState } from 'react';
import { FamilyMember, DigitalAccount, FinancialAccount, EducationDetails, NationalIdentifiers } from '../types';
import { 
  Lock, Eye, EyeOff, Plus, Trash2, Key, Check, 
  School, HelpCircle, ShieldAlert, CreditCard, Landmark, BookOpen 
} from 'lucide-react';

interface SecureSecretsProps {
  member: FamilyMember;
  onUpdateMember: (member: FamilyMember) => void;
}

export default function SecureSecrets({ member, onUpdateMember }: SecureSecretsProps) {
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
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<string[]>([]);

  // Bank Account Adder States
  const [bankName, setBankName] = useState('');
  const [bankType, setBankType] = useState('Checking');
  const [bankNumber, setBankNumber] = useState('');
  const [bankRouting, setBankRouting] = useState('');
  const [bankNotes, setBankNotes] = useState('');
  const [showAddBank, setShowAddBank] = useState(false);

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
    triggerSuccess('SSN & Identifiers saved successfully!');
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
  const handleAddDigitalAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!digitalService.trim() || !digitalUser.trim() || !digitalPass.trim()) return;

    const newAccount: DigitalAccount = {
      id: 'acc-' + Date.now(),
      serviceName: digitalService.trim(),
      username: digitalUser.trim(),
      passwordPlain: digitalPass.trim(),
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
    setShowAddDigital(false);
    triggerSuccess('Online login account added securely!');
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

  const togglePasswordVisibility = (id: string) => {
    if (visiblePasswordIds.includes(id)) {
      setVisiblePasswordIds(visiblePasswordIds.filter(pid => pid !== id));
    } else {
      setVisiblePasswordIds([...visiblePasswordIds, id]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-gray-950 p-4 border border-gray-900 rounded-2xl text-white flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-white/5 border border-white/10 text-emerald-400">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white">Credentials & Logins</h4>
            <p className="text-[10px] text-gray-400 font-light mt-0.5">Manage digital accounts, identifiers, and financial records.</p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center text-[9px] uppercase tracking-widest font-bold bg-emerald-55 border border-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full">
          Stored Locally
        </span>
      </div>

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-150 text-xs text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Bento Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: School & SSN Info */}
        <div className="xl:col-span-5 space-y-6">
          
          {/* NATIONAL IDENTIFIERS & SSN FORM */}
          <section className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
            <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1.5 pb-2 border-b border-gray-100">
              <ShieldAlert className="w-4 h-4 text-gray-500" />
              National ID &amp; SSN Credentials
            </h4>
            
            <form onSubmit={handleSaveIdentifiers} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Social Security Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. XXX-XX-4920"
                    value={ssn}
                    onChange={(e) => setSsn(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Driver&apos;s License
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. DL-EM98334"
                    value={dl}
                    onChange={(e) => setDl(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono text-gray-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Tax Ref / TIN
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TX-EMILY-44"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono text-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Insurance Plan ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BCBS-84221A"
                    value={insNo}
                    onChange={(e) => setInsNo(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 text-gray-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                  Private Identification Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Original cards stored in master bedroom heavy vault."
                  value={idNotes}
                  onChange={(e) => setIdNotes(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                Save Private Identifiers
              </button>
            </form>
          </section>

          {/* EDUCATION & SCHOOL DIRECTORY FORM */}
          <section className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
            <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1.5 pb-2 border-b border-gray-100">
              <School className="w-4 h-4 text-gray-500" />
              School &amp; Academic Directory
            </h4>
            
            <form onSubmit={handleSaveEducation} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    School / Nursery Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Lincoln Primary"
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Grade / Program
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Kindergarten"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Teacher Name / Tutor
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Mrs. Sarah Jenkins"
                    value={teacher}
                    onChange={(e) => setTeacher(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                    Class Room
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. A-104"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                  Teacher Contact Info (Email / Mobile)
                </label>
                <input
                  type="text"
                  placeholder="e.g. sjenkins@lincolnps.edu or +1-555-894-3220"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>

              <div>
                <label className="block text-[9px] font-bold text-gray-405 uppercase tracking-wide mb-1">
                  Schedule, Dropoff or Custom Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Drop-off 8:15 AM, pick-up 12:30 PM. Thursday early dismissal."
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
              >
                Save Academic Directory Details
              </button>
            </form>
          </section>

        </div>

        {/* RIGHT COLUMN: Logins and Bank Accounts */}
        <div className="xl:col-span-7 space-y-6">
          
          {/* SECURE ONLINE LOGINS PANEL */}
          <section className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1.5">
                <Key className="w-4 h-4 text-gray-500" />
                Digital Portals &amp; Subscriptions
              </h4>
              <button
                onClick={() => setShowAddDigital(!showAddDigital)}
                className="text-[10px] font-bold text-gray-900 uppercase hover:underline decoration-1 cursor-pointer"
              >
                {showAddDigital ? 'Close Form' : '+ Add Portal'}
              </button>
            </div>

            {showAddDigital && (
              <form onSubmit={handleAddDigitalAccount} className="bg-gray-55 p-4 rounded-xl border border-gray-150 space-y-3.5 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Service / Portal Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Disney+ Vault"
                      value={digitalService}
                      onChange={(e) => setDigitalService(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Access Link / URL
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. disneyplus.com"
                      value={digitalUrl}
                      onChange={(e) => setDigitalUrl(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Email or Username
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. smithkids"
                      value={digitalUser}
                      onChange={(e) => setDigitalUser(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Plaintext Password
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="SecretPass123"
                      value={digitalPass}
                      onChange={(e) => setDigitalPass(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    Logins Note (Hints / Backup Codes)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Backup codes stored on Emily's phone key log."
                    value={digitalNotes}
                    onChange={(e) => setDigitalNotes(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddDigital(false)}
                    className="px-3 py-1.5 text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-lg text-[10px] font-bold uppercase transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-gray-950 hover:bg-black text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                  >
                    Commit Vault Item
                  </button>
                </div>
              </form>
            )}

            {/* List Logins */}
            <div className="space-y-3">
              {(!member.digitalAccounts || member.digitalAccounts.length === 0) ? (
                <div className="text-center py-6 text-gray-400 text-xs italic">
                  No encrypted login keys added. Add child portal keys above.
                </div>
              ) : (
                member.digitalAccounts.map(acc => (
                  <div key={acc.id} className="p-3.5 bg-gray-50 border border-gray-150 rounded-xl flex items-start justify-between gap-3 text-xs leading-normal">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-gray-900">{acc.serviceName}</span>
                        {acc.url && (
                          <span className="text-[10px] font-mono text-gray-400">({acc.url})</span>
                        )}
                      </div>
                      <p className="text-gray-600">User: <span className="font-mono text-gray-800 bg-gray-200/50 px-1 py-0.2 rounded font-semibold">{acc.username}</span></p>
                      
                      {/* Interactive Eyeglass Password Viewer */}
                      <div className="flex items-center space-x-2 mt-1.5">
                        <span className="text-gray-400 text-[10px] uppercase font-bold">Password:</span>
                        <input
                          type={visiblePasswordIds.includes(acc.id) ? "text" : "password"}
                          readOnly
                          value={acc.passwordPlain}
                          className="font-mono text-gray-900 bg-transparent py-0.2 focus:outline-none w-28 text-xs select-all text-ellipsis"
                        />
                        <button
                          onClick={() => togglePasswordVisibility(acc.id)}
                          className="p-1 hover:bg-gray-200 rounded text-gray-500"
                        >
                          {visiblePasswordIds.includes(acc.id) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {acc.notes && (
                        <p className="text-[10.5px] text-gray-400 italic mt-1 bg-white p-1.5 rounded border border-gray-100">
                          &ldquo;{acc.notes}&rdquo;
                        </p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => handleDeleteDigitalAccount(acc.id)}
                      className="p-1 px-1.5 text-gray-400 hover:text-red-650 hover:bg-white rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* SECURE BLOCK FOR BANK / FINANCIAL ACCOUNTS */}
          <section className="bg-white p-5 rounded-2xl border border-gray-150 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <h4 className="text-[10px] font-bold text-gray-950 uppercase tracking-widest flex items-center gap-1.5">
                <Landmark className="w-4 h-4 text-gray-500" />
                Financial Reference &amp; Utilities
              </h4>
              <button
                onClick={() => setShowAddBank(!showAddBank)}
                className="text-[10px] font-bold text-gray-900 uppercase hover:underline decoration-1 cursor-pointer"
              >
                {showAddBank ? 'Close Form' : '+ Add Asset'}
              </button>
            </div>

            {showAddBank && (
              <form onSubmit={handleAddBankAccount} className="bg-gray-55 p-4 rounded-xl border border-gray-150 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Issuer (e.g. Chase Bank, PG&amp;E)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Chase Family Checking"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Account Type
                    </label>
                    <select
                      value={bankType}
                      onChange={(e) => setBankType(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none"
                    >
                      <option value="Checking">Checking Account</option>
                      <option value="Savings">Savings Pool</option>
                      <option value="Utility">Utility Service Link</option>
                      <option value="Credit Card">Credit Card Line</option>
                      <option value="Other">Other Reference</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Account Number
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 982245104"
                      value={bankNumber}
                      onChange={(e) => setBankNumber(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                      Routing / Reference No
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. RT-021000021"
                      value={bankRouting}
                      onChange={(e) => setBankRouting(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                    Financial Note/Authorized Signers
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Both parents hold signatures."
                    value={bankNotes}
                    onChange={(e) => setBankNotes(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-gray-250 rounded-xl focus:outline-none"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddBank(false)}
                    className="px-3 py-1.5 text-gray-500 hover:text-gray-700 bg-white border border-gray-200 rounded-lg text-[10px] font-bold uppercase transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-gray-950 hover:bg-black text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                  >
                    Commit Asset Info
                  </button>
                </div>
              </form>
            )}

            {/* List Bank Reference Logs */}
            <div className="space-y-3">
              {(!member.financialAccounts || member.financialAccounts.length === 0) ? (
                <div className="text-center py-6 text-gray-400 text-xs italic">
                  No reference bank accounts cataloged.
                </div>
              ) : (
                member.financialAccounts.map(b => (
                  <div key={b.id} className="p-3.5 bg-gray-50 border border-gray-150 rounded-xl flex items-start justify-between gap-3 text-xs leading-normal">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                        <span className="font-bold text-gray-900">{b.bankName}</span>
                        <span className="text-[9px] uppercase tracking-wide font-bold bg-gray-100 text-gray-500 px-1.5 py-0.2 rounded">
                          {b.accountType}
                        </span>
                      </div>
                      <p className="text-gray-600 font-mono">
                        Account: <span className="font-bold text-gray-800 bg-white border border-gray-150 px-1.5 py-0.2 rounded select-all">{b.accountNumber}</span>
                        {b.routingNumber && (
                          <span className="ml-3 font-normal text-gray-400">Routing: <span className="font-semibold text-gray-700 bg-white border border-gray-150 px-1.5 py-0.2 rounded select-all">{b.routingNumber}</span></span>
                        )}
                      </p>
                      {b.notes && (
                        <p className="text-[10.5px] text-gray-450 italic mt-1 font-light">
                          &ldquo;{b.notes}&rdquo;
                        </p>
                      )}
                    </div>
                    
                    <button
                      onClick={() => handleDeleteBankAccount(b.id)}
                      className="p-1 px-1.5 text-gray-400 hover:text-red-650 hover:bg-white rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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
