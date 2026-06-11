import React, { useState, useEffect } from 'react';
import { FamilyMember, ClothingSizes, PassportInfo, FamilyDocument, CalendarEvent } from '../types';
import { 
  loadFamilyMembers, saveFamilyMembers, DEFAULT_FAMILY,
  loadCalendarEvents, saveCalendarEvents, DEFAULT_EVENTS 
} from '../utils/db';
import { auth, loginWithGoogle, logout } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import AddMemberModal from './AddMemberModal';
import EditMemberModal from './EditMemberModal';
import MemberSizing from './MemberSizing';
import PassportDetails from './PassportDetails';
import MemberDocuments from './MemberDocuments';
import DocumentViewer from './DocumentViewer';
import GrowthTracker from './GrowthTracker';
import SecureSecrets from './SecureSecrets';
import FamilyCalendar from './FamilyCalendar';
import FamilyChat from './FamilyChat';
import GoogleDriveSync from './GoogleDriveSync';
import MemberFavorites from './MemberFavorites';
import { 
  Users, UserPlus, FileText, Compass, Search, 
  Layers, Bell, AlertTriangle, User, ShieldCheck, 
  Scissors, Trash2, Lock, Unlock, Key, TrendingUp, Calendar, Info,
  Download, Heart, LogOut, LogIn
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function calculateAge(birthdate?: string): string | null {
  if (!birthdate) return null;
  const birthDate = new Date(birthdate);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  if (age < 0) return null;
  if (age === 0) {
    const months = (today.getFullYear() - birthDate.getFullYear()) * 12 + today.getMonth() - birthDate.getMonth();
    if (months <= 0) return "Newborn";
    return `${months}m`;
  }
  return `${age} yrs`;
}

export default function Dashboard() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'sizes' | 'growth' | 'passport' | 'documents' | 'secrets' | 'favorites'>('sizes');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<FamilyDocument | null>(null);
  const [selectedDocumentMemberName, setSelectedDocumentMemberName] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmMemberId, setDeleteConfirmMemberId] = useState<string | null>(null);
  
  // High level View selector
  const [mainView, setMainView] = useState<'profiles' | 'calendar' | 'chat' | 'drive'>('profiles');
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    // Set a timeout to prevent infinite loading spinner in Safari if auth is blocked
    const timeout = setTimeout(() => {
      if (isAuthLoading) {
        setIsAuthLoading(false);
      }
    }, 3000);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
      clearTimeout(timeout);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [isAuthLoading]);

  // Load families & events on mount or user change
  useEffect(() => {
    async function init() {
      // Don't auto-load unless authenticated to prevent local mixups
      if (!currentUser) {
        setMembers([]);
        setEvents([]);
        return;
      }

      let data = await loadFamilyMembers();
      if (data && data.length > 0) {
        // Automatically purge any remaining old mock data from localStorage
        const oldLength = data.length;
        data = data.filter(m => {
          const lowerName = m.name.toLowerCase();
          // Filter out Vita (the one triggering the expiry warning) and other generic mocks
          return !['vita', 'amina', 'amya'].includes(lowerName);
        });
        
        if (data.length !== oldLength) {
          await saveFamilyMembers(data);
        }
        
        setMembers(data);
        if (data.length > 0) {
          setSelectedMemberId(data[0].id);
        }
      } else {
        setMembers([]);
      }

      // Load calendar
      const calData = await loadCalendarEvents();
      if (calData && calData.length > 0) {
        const filteredEvents = calData.filter(e => !e.title.toLowerCase().includes('wellness') && !e.title.toLowerCase().includes("amya"));
        if (filteredEvents.length !== calData.length) {
            await saveCalendarEvents(filteredEvents);
        }
        setEvents(filteredEvents);
      } else {
        setEvents([]);
      }
    }
    init();
  }, [currentUser]);

  // Sync back on modify
  const persistChanges = async (updated: FamilyMember[]) => {
    setMembers(updated);
    await saveFamilyMembers(updated);
  };

  const handleSaveEvents = async (updatedEvents: CalendarEvent[]) => {
    setEvents(updatedEvents);
    await saveCalendarEvents(updatedEvents);
  };

  // Profile actions
  const handleAddMember = async (newMember: Omit<FamilyMember, 'documents'>) => {
    const fullMember: FamilyMember = {
      ...newMember,
      documents: []
    };
    const updated = [...members, fullMember];
    await persistChanges(updated);
    setSelectedMemberId(fullMember.id);
  };

  const handleDeleteMember = async (id: string) => {
    const updated = members.filter(m => m.id !== id);
    await persistChanges(updated);
    setDeleteConfirmMemberId(null);
    if (selectedMemberId === id && updated.length > 0) {
      setSelectedMemberId(updated[0].id);
    }
  };

  const handleUpdateSizes = async (memberId: string, sizes: ClothingSizes) => {
    const updated = members.map(m => {
      if (m.id === memberId) {
        return { ...m, clothingSizes: sizes };
      }
      return m;
    });
    await persistChanges(updated);
  };

  const handleUpdatePassport = async (memberId: string, passport: PassportInfo | undefined) => {
    const updated = members.map(m => {
      if (m.id === memberId) {
        return { ...m, passport };
      }
      return m;
    });
    await persistChanges(updated);
  };

  const handleAddDocument = async (memberId: string, doc: FamilyDocument) => {
    const updated = members.map(m => {
      if (m.id === memberId) {
        return { ...m, documents: [...m.documents, doc] };
      }
      return m;
    });
    await persistChanges(updated);
  };

  const handleDeleteDocument = async (memberId: string, docId: string) => {
    const updated = members.map(m => {
      if (m.id === memberId) {
        return { ...m, documents: m.documents.filter(d => d.id !== docId) };
      }
      return m;
    });
    await persistChanges(updated);
  };

  const handleUpdateMember = async (updatedMember: FamilyMember) => {
    const updated = members.map(m => m.id === updatedMember.id ? updatedMember : m);
    await persistChanges(updated);
  };

  const handleViewDocument = (doc: FamilyDocument, memberName: string) => {
    setSelectedDocument(doc);
    setSelectedDocumentMemberName(memberName);
  };

// Member update actions

  const handleExportAllData = () => {
    try {
      const backupData = {
        exportedAt: new Date().toISOString(),
        author: 'Family Vault Backup Agent',
        members: members,
        calendarEvents: events,
      };

      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const exportFileDefaultName = `family_vault_backup_${new Date().toISOString().split('T')[0]}.json`;

      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', url);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();

      // Clean up the URL object after clicking
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to generate offline backup data.');
    }
  };

  const handleImportAllData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const backupData = JSON.parse(content);
        
        if (backupData.members && Array.isArray(backupData.members)) {
          await persistChanges(backupData.members);
        }
        
        if (backupData.calendarEvents && Array.isArray(backupData.calendarEvents)) {
          await handleSaveEvents(backupData.calendarEvents);
        }
        
        alert('Data successfully imported and synchronized!');
      } catch (error) {
        console.error('Import failed:', error);
        alert('Failed to parse backup data. Ensure it is a valid family vault JSON file.');
      }
    };
    reader.readAsText(file);
  };

  // Compute stats helper
  const totalDocuments = members.reduce((acc, m) => acc + (m.documents?.length || 0), 0);
  const selectedMember = members.find(m => m.id === selectedMemberId);

  // Expiry notifications generator for full family
  const passportWarnings = members
    .filter(m => m.passport?.expiryDate)
    .map(m => {
      const today = new Date('2026-05-22');
      const expiry = new Date(m.passport!.expiryDate);
      const diffTime = expiry.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const monthsLeft = Number((diffDays / 30.4375).toFixed(1));
      return { member: m, monthsLeft, status: diffTime < 0 ? 'expired' : monthsLeft <= 9 ? 'critical' : 'none' };
    })
    .filter(warning => warning.status !== 'none');

  // Multi-attribute search matching
  const filteredMembers = searchQuery.trim() === '' 
    ? members 
    : members.filter(m => {
        const query = searchQuery.toLowerCase();
        const sizesText = JSON.stringify(m.clothingSizes).toLowerCase();
        const schoolText = m.education?.schoolName?.toLowerCase() || '';
        const digitalAccountsText = JSON.stringify(m.digitalAccounts || []).toLowerCase();
        const passportNo = m.passport?.passportNumber.toLowerCase() || '';
        return m.name.toLowerCase().includes(query) || 
               m.role.toLowerCase().includes(query) ||
               sizesText.includes(query) ||
               schoolText.includes(query) ||
               digitalAccountsText.includes(query) ||
               passportNo.includes(query);
      });

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] flex items-center justify-center font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#F4F7F6] flex items-center justify-center font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-sm text-center max-w-sm w-full mx-4 border border-gray-150">
          <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold tracking-tight text-gray-900 mb-2">Family Vault</h1>
          <p className="text-sm text-gray-500 mb-8">Secure your family's records with encrypted cloud sync across all your devices.</p>
          <button
            onClick={loginWithGoogle}
            className="w-full flex items-center justify-center space-x-2 bg-gray-950 hover:bg-gray-900 text-white py-3 px-4 rounded-xl font-semibold transition-colors shadow-sm"
          >
            <LogIn className="w-5 h-5" />
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7F6] text-gray-900 pb-12 font-sans">
      {/* Top Header Panel */}
      <header className="bg-white border-b border-gray-150 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <span className="w-1.5 h-6 bg-gray-900 rounded-full inline-block"></span>
            <div>
              <h1 className="text-sm font-bold tracking-widest text-gray-900 uppercase">
                Family Organizer
              </h1>
              <p className="text-[9px] text-gray-450 uppercase tracking-widest font-bold mt-0.5">Secure Records &amp; Planner</p>
            </div>
          </div>

          {/* Core Navigation Toggle: Member Profiles vs Calendar vs Workspace Chat */}
          <div className="flex items-center space-x-4 overflow-x-auto mx-auto sm:mx-0">
            <div className="flex items-center space-x-1 bg-gray-100 p-0.5 rounded-xl border border-gray-150">
              <button
                type="button"
                onClick={() => setMainView('profiles')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                  mainView === 'profiles'
                    ? 'bg-white text-gray-950 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Profiles
              </button>
              <button
                type="button"
                onClick={() => setMainView('calendar')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                  mainView === 'calendar'
                    ? 'bg-white text-gray-950 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Calendar
              </button>
              <button
                type="button"
                onClick={() => setMainView('chat')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                  mainView === 'chat'
                    ? 'bg-white text-gray-950 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setMainView('drive')}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                  mainView === 'drive'
                    ? 'bg-white text-gray-950 shadow-xs'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Sync
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-3 ml-auto sm:ml-0">
            {/* Search Input bar */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3.5 top-2.5 w-3.5 h-3.5 text-gray-450" />
              <input
                type="text"
                placeholder="Search sizes, portals, SSN, documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 w-64 border border-gray-200 rounded-xl text-xs bg-gray-50 hover:bg-gray-100 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-950 transition-all font-sans"
              />
            </div>

            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center space-x-1 px-4 py-2 bg-gray-950 hover:bg-black text-white rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-all whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Profile</span>
            </button>
            
            <button
              onClick={logout}
              className="flex items-center space-x-1 px-3 py-2 bg-white text-gray-700 hover:bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold uppercase tracking-wider cursor-pointer transition-all whitespace-nowrap"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Panel Content container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        
        {/* Render CALENDAR view directly if selected */}
        {mainView === 'calendar' && (
          <FamilyCalendar
            members={members}
            events={events}
            onSaveEvents={handleSaveEvents}
          />
        )}

        {/* Render FAMILY REAL-TIME CHAT if selected */}
        {mainView === 'chat' && (
          <FamilyChat
            members={members}
            selectedMemberId={selectedMemberId}
          />
        )}

        {/* Render GOOGLE DRIVE SYNC EXPLORER if selected */}
        {mainView === 'drive' && (
          <GoogleDriveSync />
        )}
        
        {mainView === 'profiles' && (
          <>
            {/* Urgent Warnings Box if passports expire soon */}
            {passportWarnings.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/55 flex items-start gap-3 shadow-xs">
                <div className="p-1.5 rounded-xl bg-amber-100/80 text-amber-800 mt-0.5 shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[10px] font-bold text-amber-950 uppercase tracking-wider font-sans">
                    Passport Expiry Notices
                  </h3>
                  <div className="mt-1 space-y-1 text-xs text-amber-800 font-sans">
                    {passportWarnings.map((warning, i) => (
                      <p key={i}>
                        ✈️ <strong>{warning.member.name}</strong>&apos;s passport {warning.status === 'expired' ? 'has expired' : `is expiring within ${warning.monthsLeft} months`}. Consider scheduling a renewal check on the family schedule.
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Dashboard layout Grid system */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Member Profile Sidebar Column */}
              <section className="lg:col-span-4 space-y-5">
                {/* Mobile Search block */}
                <div className="block md:hidden font-sans">
                  <div className="relative">
                    <Search className="absolute left-3.5 top-3 w-3.5 h-3.5 text-gray-450" />
                    <input
                      type="text"
                      placeholder="Search credentials, SSN, logins..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2.5 w-full border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-1 focus:ring-gray-900 focus:border-gray-900"
                    />
                  </div>
                </div>

                <div className="bg-white border border-gray-150 rounded-2xl p-5 space-y-4 shadow-xs">
                  <div className="flex items-center justify-between pb-3.5 border-b border-gray-100">
                    <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Family Directory
                    </h4>
                    <span className="text-[10px] font-bold text-gray-900 bg-gray-105 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      {members.length} Profile{members.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Filtering summary warning if query typed */}
                  {searchQuery && (
                    <p className="text-xs text-gray-500 italic mt-1 bg-gray-50 p-2 rounded-lg border border-gray-100">
                      Filtering by: &ldquo;{searchQuery}&rdquo;
                    </p>
                  )}

                  {filteredMembers.length === 0 ? (
                    <div className="text-center py-10">
                      <p className="text-xs font-semibold text-gray-400">No profile matches found.</p>
                    </div>
                  ) : (
                    <div className="space-y-3 font-sans">
                      {filteredMembers.map((member) => (
                        <div
                          key={member.id}
                          onClick={() => {
                            setSelectedMemberId(member.id);
                            setDeleteConfirmMemberId(null);
                          }}
                          className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                            selectedMemberId === member.id
                              ? 'border-gray-950 bg-gray-50/50 shadow-xs ring-1 ring-gray-950/5'
                              : 'border-gray-150 bg-white hover:bg-gray-50 hover:border-gray-200'
                          }`}
                        >
                          <div className="flex items-center space-x-3.5 min-w-0">
                            {/* Avatar initials badge or photo */}
                            <div className="relative shrink-0">
                              {member.avatarUrl ? (
                                <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 border border-gray-150 relative">
                                  <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
                                </div>
                              ) : (
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 transition-colors uppercase ${
                                  selectedMemberId === member.id 
                                    ? `${member.avatarColor} text-white shadow-xs` 
                                    : 'bg-gray-100 text-gray-650'
                                }`}>
                                  {member.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              {(member.id === selectedMemberId || !!member.isOnline) && (
                                <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 select-none">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white"></span>
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5 flex-wrap">
                                <span>{member.name}</span>
                                <span className="text-[8px] font-bold uppercase tracking-wider text-gray-450 bg-gray-105 rounded-md px-1.5 py-0.5 leading-none shrink-0">
                                  {member.role}
                                </span>
                                {member.birthdate && (
                                  <span className="text-[8px] font-bold text-indigo-650 bg-indigo-50 border border-indigo-100/60 rounded px-1.5 py-0.5 font-mono leading-none shrink-0">
                                    {calculateAge(member.birthdate)}
                                  </span>
                                )}
                                {(member.id === selectedMemberId || !!member.isOnline) && (
                                  <span className="text-[7.5px] font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-150 rounded px-1 py-0.5 uppercase tracking-wider leading-none shrink-0 flex items-center gap-0.5">
                                    <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                                    On
                                  </span>
                                )}
                              </h4>
                              <p className="text-[10px] text-gray-400 font-medium truncate mt-0.5">
                                {member.documents?.length || 0} doc{member.documents?.length !== 1 ? 's' : ''} • {member.growthHistory?.length || 0} checkups • {member.digitalAccounts?.length || 0} secure keys
                              </p>
                            </div>
                          </div>

                          {/* Trash button icon */}
                          {selectedMemberId === member.id && (
                            <div onClick={(e) => e.stopPropagation()} className="relative flex items-center">
                              {deleteConfirmMemberId === member.id ? (
                                <div className="flex items-center space-x-1 text-[8px] font-bold uppercase tracking-wider">
                                  <button
                                    onClick={() => handleDeleteMember(member.id)}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors cursor-pointer"
                                  >
                                    Del
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmMemberId(null)}
                                    className="px-1.5 py-1 border border-gray-200 text-gray-550 rounded-md bg-white hover:bg-gray-50 cursor-pointer"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirmMemberId(member.id)}
                                  className="p-1 px-1.5 text-gray-400 hover:text-red-650 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                                  title="Remove Profile"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Active Profile detail Section */}
              <section className="lg:col-span-8 space-y-5">
                {selectedMember ? (
                  <div className="bg-white border border-gray-150 rounded-2xl shadow-xs overflow-hidden min-h-[500px] flex flex-col">
                    
                    {/* Active Member Bio panel */}
                    <div className="p-5 sm:p-6 bg-white border-b border-gray-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                      <div className="flex items-center space-x-4 min-w-0">
                        {selectedMember.avatarUrl ? (
                          <div className="w-11 h-11 rounded-xl overflow-hidden border border-gray-150 shadow-xs relative shrink-0 bg-white">
                            <img src={selectedMember.avatarUrl} alt={selectedMember.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className={`w-11 h-11 rounded-xl ${selectedMember.avatarColor} text-white font-semibold text-base flex items-center justify-center shadow-xs uppercase shrink-0`}>
                            {selectedMember.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h2 className="text-base font-semibold text-gray-950 tracking-tight flex items-center gap-2">
                            <span>{selectedMember.name}&apos;s Folder</span>
                            <button
                              type="button"
                              onClick={() => setIsEditingProfile(true)}
                              className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md border border-slate-250 transition-colors cursor-pointer select-none"
                              title="Edit Member Name, Role, or Portrait"
                            >
                              ⚙️ Edit Profile
                            </button>
                          </h2>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5 flex flex-wrap items-center gap-1.5 leading-none">
                            <span>{selectedMember.role}</span>
                            {selectedMember.birthdate && (
                              <>
                                <span>•</span>
                                <span>Birthdate: {selectedMember.birthdate}</span>
                                <span className="text-[9px] font-extrabold text-indigo-700 bg-indigo-50/80 border border-indigo-150 rounded px-1.5 py-0.5 normal-case font-mono shrink-0">
                                  {calculateAge(selectedMember.birthdate)} old
                                </span>
                              </>
                            )}
                            <span>•</span>
                            {(selectedMember.id === selectedMemberId || !!selectedMember.isOnline) ? (
                              <span className="text-[9px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-150 rounded px-1.5 py-0.5 normal-case font-mono shrink-0 flex items-center gap-1 uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                Active Now
                              </span>
                            ) : (
                              <span className="text-[9px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 normal-case font-mono shrink-0 flex items-center gap-1 uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                offline
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Responsive, balanced tab navigation inside profile */}
                      <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl w-fit self-start md:self-auto select-none">
                        <button
                          type="button"
                          onClick={() => setActiveTab('sizes')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'sizes'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <Scissors className="w-3.5 h-3.5" />
                          <span>Sizes</span>
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => setActiveTab('favorites')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'favorites'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
                          <span>Likes</span>
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => setActiveTab('growth')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'growth'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <TrendingUp className="w-3.5 h-3.5" />
                          <span>Growth</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('passport')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'passport'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Passport</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('documents')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'documents'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>Scans</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('secrets')}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                            activeTab === 'secrets'
                              ? 'bg-white text-gray-950 shadow-xs'
                              : 'text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          <Key className="w-3.5 h-3.5" />
                          <span>Secrets</span>
                        </button>
                      </div>
                    </div>

                    {/* Sub-module render panel */}
                    <div className="p-5 sm:p-6 flex-1">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={activeTab + '-' + selectedMember.id}
                          initial={{ opacity: 0, y: 3 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.12 }}
                        >
                            <>
                              {activeTab === 'sizes' && (
                                <MemberSizing
                                  member={selectedMember}
                                  onUpdateSizes={handleUpdateSizes}
                                />
                              )}

                              {activeTab === 'favorites' && (
                                <MemberFavorites
                                  member={selectedMember}
                                  onUpdateMember={handleUpdateMember}
                                />
                              )}

                              {activeTab === 'growth' && (
                                <GrowthTracker
                                  member={selectedMember}
                                  onUpdateMember={handleUpdateMember}
                                />
                              )}

                              {activeTab === 'passport' && (
                                <PassportDetails
                                  member={selectedMember}
                                  onUpdatePassport={handleUpdatePassport}
                                />
                              )}

                              {activeTab === 'documents' && (
                                <MemberDocuments
                                  member={selectedMember}
                                  onAddDocument={handleAddDocument}
                                  onDeleteDocument={handleDeleteDocument}
                                  onViewDocument={handleViewDocument}
                                />
                              )}

                              {activeTab === 'secrets' && (
                                <SecureSecrets
                                  member={selectedMember}
                                  onUpdateMember={handleUpdateMember}
                                />
                              )}
                            </>
                        </motion.div>
                      </AnimatePresence>
                    </div>

                  </div>
                ) : (
                  <div className="bg-white border border-gray-150 rounded-2xl shadow-xs text-center py-24 px-4 font-sans">
                    <User className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-sm font-semibold text-gray-800">No profile selected</h3>
                    <p className="text-xs text-gray-400 mt-1">Please select or register a household member from the directory list.</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {/* Clean Minimalism Encrypted Footer Banner */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 text-center pb-6">
        <div className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-white rounded-full border border-gray-150 shadow-xs text-[10px] uppercase tracking-widest font-bold text-gray-400">
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          <span>End-to-End Encrypted Access Only</span>
          <span className="text-gray-300 font-light">•</span>
          <span>Device Auth Enabled</span>
        </div>
      </footer>

      {/* Main Document inspection Viewer modal */}
      <DocumentViewer
        document={selectedDocument}
        memberName={selectedDocumentMemberName}
        onClose={() => {
          setSelectedDocument(null);
          setSelectedDocumentMemberName('');
        }}
      />

      {/* Profile creation Modal */}
      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddMember}
      />

      {/* Profile edit Modal */}
      <EditMemberModal
        isOpen={isEditingProfile}
        member={selectedMember}
        onClose={() => setIsEditingProfile(false)}
        onSave={handleUpdateMember}
      />
    </div>
  );
}
