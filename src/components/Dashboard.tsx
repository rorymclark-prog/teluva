import React, { useState, useEffect, useRef } from 'react';
import { FamilyMember, ClothingSizes, PassportInfo, FamilyDocument, CalendarEvent, AssetItem } from '../types';
import { useFamilyCtx } from '../contexts/FamilyContext';
import {
  loadFamilyMembers, saveFamilyMembers,
  loadCalendarEvents, saveCalendarEvents,
  loadFamilyInfo, saveFamilyInfo,
  loadHousehold, saveHousehold,
  loadFinances, saveFinances,
  loadTimeline, saveTimeline,
  loadSettings, saveSettings,
  loadDocuments, saveDocuments,
  loadShopping, saveShopping,
  saveAsset,
} from '../utils/db';
import {
  applyMemberEdits, applyInfoEdits, hasMemberEdits, hasInfoEdits,
  applyCalendarEdits, applyHouseholdEdits, applyFinancesEdits, applyTimelineEdits,
  hasCalendarEdits, hasHouseholdEdits, hasFinancesEdits, hasTimelineEdits,
  hasShoppingEdits, applyShoppingEdits, hasAssetEdits,
} from '../utils/aiApply';
import AIChatbot, { AiEdit } from './AIChatbot';
import HubSettingsModal from './HubSettingsModal';
import ImageLightbox from './ImageLightbox';
import { HubSettings } from '../types';
import { auth, loginWithGoogle, logout } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { DEMO_MEMBERS, DEMO_EVENTS, isDemoMode } from '../utils/demoData';
import { warmAvatarColor } from '../utils/avatarPalette';
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
import ShoppingList from './ShoppingList';
import ImportantInfo from './ImportantInfo';
import MemberFavorites from './MemberFavorites';
import MemberMedical from './MemberMedical';
import MemberIDs from './MemberIDs';
import MemberTravel from './MemberTravel';
import MemberPreferences from './MemberPreferences';
import EmergencyView from './EmergencyView';
import HouseholdView from './HouseholdView';
import FinancesView from './FinancesView';
import TimelineView from './TimelineView';
import DocumentVault from './DocumentVault';
import Assets from './Assets';
import FamilyPasswords from './FamilyPasswords';
import {
  Users, UserPlus, FileText, Search, Bell, User, ShieldCheck,
  Scissors, Trash2, Lock, Key, TrendingUp, Calendar, Heart,
  LogOut, LogIn, Download, Upload, Cloud, CloudOff, MessageCircle, IdCard,
  HeartPulse, Plane, Sparkles, Siren, Home, Landmark, CalendarHeart, FolderArchive, GripVertical, ShoppingCart,
  Package, KeyRound
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';

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
    if (months <= 0) return 'Newborn';
    return `${months}m`;
  }
  return `${age} yrs`;
}

type TabId = 'sizes' | 'favorites' | 'growth' | 'medical' | 'ids' | 'travel' | 'preferences' | 'passport' | 'documents' | 'secrets';
type ViewId = 'profiles' | 'assistant' | 'calendar' | 'info' | 'emergency' | 'household' | 'finances' | 'timeline' | 'vault' | 'shopping' | 'chat' | 'drive' | 'assets' | 'passwords';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'medical', label: 'Medical', icon: HeartPulse },
  { id: 'ids', label: 'IDs', icon: IdCard },
  { id: 'sizes', label: 'Sizes', icon: Scissors },
  { id: 'favorites', label: 'Wishlist', icon: Heart },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'travel', label: 'Travel', icon: Plane },
  { id: 'preferences', label: 'Likes', icon: Sparkles },
  { id: 'passport', label: 'Passport', icon: Lock },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'secrets', label: 'Secrets', icon: Key },
];

const VIEWS: { id: ViewId; label: string; icon: React.ElementType }[] = [
  { id: 'profiles', label: 'Profiles', icon: Users },
  { id: 'assistant', label: 'Assistant', icon: Sparkles },
  { id: 'emergency', label: 'Emergency', icon: Siren },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'info', label: 'Info', icon: IdCard },
  { id: 'household', label: 'Household', icon: Home },
  { id: 'finances', label: 'Finances', icon: Landmark },
  { id: 'timeline', label: 'Timeline', icon: CalendarHeart },
  { id: 'vault', label: 'Documents', icon: FolderArchive },
  { id: 'assets', label: 'Assets', icon: Package },
  { id: 'shopping', label: 'Shopping', icon: ShoppingCart },
  { id: 'passwords', label: 'Passwords', icon: KeyRound },
  { id: 'chat', label: 'Chat', icon: MessageCircle },
  { id: 'drive', label: 'Drive', icon: Cloud },
];

// A draggable family-list row where ONLY the grip handle starts a drag
// (dragListener disabled), so tapping or scrolling the card never reorders it.
interface DraggableRowProps {
  member: FamilyMember;
  className: string;
  onSelect: () => void;
  onDragEnd: () => void;
  renderInner: (member: FamilyMember, grip?: React.ReactNode) => React.ReactNode;
}

const DraggableRow: React.FC<DraggableRowProps> = ({ member, className, onSelect, onDragEnd, renderInner }) => {
  const controls = useDragControls();
  const grip = (
    <div
      onPointerDown={(e) => { e.stopPropagation(); controls.start(e); }}
      onClick={(e) => e.stopPropagation()}
      className="cursor-grab active:cursor-grabbing touch-none p-1.5 -ml-1 rounded-lg text-ink-300 hover:text-ink-600 hover:bg-cream-100 shrink-0"
      title="Drag to reorder"
    >
      <GripVertical className="w-4 h-4" />
    </div>
  );
  return (
    <Reorder.Item
      value={member}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={className}
    >
      {renderInner(member, grip)}
    </Reorder.Item>
  );
}

interface DashboardProps {
  /** Admin-only gear button injected by AppInner; null when not admin or not signed in */
  familySettingsButton?: React.ReactNode;
}

export default function Dashboard({ familySettingsButton }: DashboardProps = {}) {
  const demo = isDemoMode();
  const { isAdmin, canWrite, role } = useFamilyCtx();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(!demo);

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('medical');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [settings, setSettings] = useState<HubSettings>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<FamilyDocument | null>(null);
  const [selectedDocumentMemberName, setSelectedDocumentMemberName] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirmMemberId, setDeleteConfirmMemberId] = useState<string | null>(null);

  const [mainView, setMainView] = useState<ViewId>('profiles');
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  // null = no save attempted yet; true/false = last save reached cloud or not
  const [cloudSynced, setCloudSynced] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    if (demo) {
      setCurrentUser({ displayName: 'Demo family', isDemo: true });
      setMembers(DEMO_MEMBERS);
      setEvents(DEMO_EVENTS);
      setSelectedMemberId(DEMO_MEMBERS[0].id);
      return;
    }

    // Safety timeout so a blocked auth popup never leaves an infinite spinner
    const timeout = setTimeout(() => setIsAuthLoading(false), 3000);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
      clearTimeout(timeout);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Load family & events when the signed-in user changes
  useEffect(() => {
    if (demo) return;

    async function init() {
      if (!currentUser) {
        setMembers([]);
        setEvents([]);
        return;
      }

      const data = await loadFamilyMembers();
      if (data && data.length > 0) {
        setMembers(data);
        setSelectedMemberId(data[0].id);
      } else {
        setMembers([]);
      }

      const calData = await loadCalendarEvents();
      setEvents(calData && calData.length > 0 ? calData : []);

      const hub = await loadSettings();
      if (hub) setSettings(hub);
    }
    init();
  }, [currentUser]);

  const hubName = settings.hubName || 'Family Hub';

  // How to render a member's name (fun display preference)
  const memberName = (m: FamilyMember) => {
    const mode = settings.nameDisplay || 'both';
    if (mode === 'nick') return m.nickname || m.name;
    if (mode === 'real') return m.name;
    return m.nickname ? `${m.name} “${m.nickname}”` : m.name;
  };

  const handleSaveSettings = async (next: HubSettings) => {
    setSettings(next);
    setIsSettingsOpen(false);
    if (!demo) await saveSettings(next);
  };

  // Drag-to-reorder the family list. onReorder updates live; we persist the
  // new order (the saved metadata.ids array preserves it) when the drag ends.
  const membersRef = useRef(members);
  useEffect(() => { membersRef.current = members; }, [members]);

  const handleReorder = (newOrder: FamilyMember[]) => {
    setMembers(newOrder);
    membersRef.current = newOrder;
  };

  const saveOrder = async () => {
    if (demo) return;
    const ok = await saveFamilyMembers(membersRef.current);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — cloud sync didn't go through.");
  };

  const cardClass = (member: FamilyMember) =>
    `w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
      selectedMemberId === member.id
        ? 'border-clay-300 bg-clay-50 ring-1 ring-clay-200'
        : 'border-cream-200 bg-white hover:bg-cream-100 hover:border-cream-300'
    }`;

  // Inner content of a family-list card. `grip` (when provided) is the drag
  // handle node — only it starts a drag, so tapping/scrolling the card is safe.
  const memberCardInner = (member: FamilyMember, grip?: React.ReactNode) => (
    <>
      <div className="flex items-center gap-2 min-w-0">
        {grip}
        {member.avatarUrl ? (
          <div
            onClick={(e) => { e.stopPropagation(); setLightboxImage(member.avatarUrl!); }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            className="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-cream-300 cursor-zoom-in"
            title="View photo"
          >
            <img src={member.avatarUrl} alt={member.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-base text-white shrink-0 uppercase ${warmAvatarColor(member.avatarColor)}`}>
            {member.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink-900 truncate flex items-center gap-1.5 flex-wrap">
            <span>{memberName(member)}</span>
            <span className="chip bg-cream-200 text-ink-600">{member.role}</span>
            {member.birthdate && (
              <span className="chip bg-dusk-100 text-dusk-700">{calculateAge(member.birthdate)}</span>
            )}
          </h4>
          {(() => {
            const parts: string[] = [];
            if (member.medical?.bloodGroup) parts.push(member.medical.bloodGroup);
            if (member.role === 'Child' && member.education?.schoolName) parts.push(member.education.schoolName);
            if (member.medical?.allergies) parts.push(`⚠ ${member.medical.allergies}`);
            const docCount = member.documents?.length || 0;
            if (docCount > 0 && parts.length < 2) parts.push(`${docCount} doc${docCount !== 1 ? 's' : ''}`);
            return parts.length > 0 ? (
              <p className="text-[11px] text-ink-400 font-medium truncate mt-0.5">{parts.join(' · ')}</p>
            ) : null;
          })()}
        </div>
      </div>

      {selectedMemberId === member.id && isAdmin && (
        <div onClick={(e) => e.stopPropagation()} onPointerDownCapture={(e) => e.stopPropagation()} className="relative flex items-center shrink-0">
          {deleteConfirmMemberId === member.id ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleDeleteMember(member.id)}
                className="px-2.5 py-1.5 bg-rosa-500 hover:bg-rosa-700 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
              >
                Remove
              </button>
              <button
                onClick={() => setDeleteConfirmMemberId(null)}
                className="px-2 py-1.5 border border-cream-300 text-ink-500 rounded-lg bg-white hover:bg-cream-100 text-[11px] font-semibold cursor-pointer"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              onClick={() => setDeleteConfirmMemberId(member.id)}
              className="p-1.5 text-ink-400 hover:text-rosa-500 hover:bg-cream-100 rounded-lg transition-colors cursor-pointer"
              title="Remove member"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </>
  );

  const persistChanges = async (updated: FamilyMember[]) => {
    setMembers(updated);
    if (demo) return;
    const ok = await saveFamilyMembers(updated);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — cloud sync didn't go through.");
  };

  const handleSaveEvents = async (updatedEvents: CalendarEvent[]) => {
    setEvents(updatedEvents);
    if (demo) return;
    const ok = await saveCalendarEvents(updatedEvents);
    setCloudSynced(ok);
    if (!ok) showToast("Saved on this device — cloud sync didn't go through.");
  };

  const handleAddMember = async (newMember: Omit<FamilyMember, 'documents'>) => {
    const fullMember: FamilyMember = { ...newMember, documents: [] };
    const updated = [...members, fullMember];
    await persistChanges(updated);
    setSelectedMemberId(fullMember.id);
  };

  const handleDeleteMember = async (id: string) => {
    const updated = members.filter(m => m.id !== id);
    await persistChanges(updated);
    setDeleteConfirmMemberId(null);
    if (selectedMemberId === id) {
      setSelectedMemberId(updated.length > 0 ? updated[0].id : '');
    }
  };

  const handleUpdateSizes = async (memberId: string, sizes: ClothingSizes) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, clothingSizes: sizes } : m)));
  };

  const handleUpdatePassport = async (memberId: string, passport: PassportInfo | undefined) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, passport } : m)));
  };

  // Generic patch for the selected member — used by the medical/ids/travel/preferences tabs
  const handlePatchSelectedMember = async (patch: Partial<FamilyMember>) => {
    if (!selectedMemberId) return;
    await persistChanges(members.map(m => (m.id === selectedMemberId ? { ...m, ...patch } : m)));
  };

  // Apply edits proposed by the AI assistant (after the user confirms).
  const handleApplyAiEdits = async (edits: AiEdit[]) => {
    if (hasMemberEdits(edits)) {
      const next = applyMemberEdits(members, edits);
      await persistChanges(next);
    }
    if (hasInfoEdits(edits)) {
      const info = (await loadFamilyInfo()) || { numbers: [], contacts: [] };
      await saveFamilyInfo(applyInfoEdits(info, edits));
    }
    if (hasCalendarEdits(edits)) {
      await handleSaveEvents(applyCalendarEdits(events, edits, members));
    }
    if (hasHouseholdEdits(edits)) {
      const h = (await loadHousehold()) || {};
      await saveHousehold(applyHouseholdEdits(h, edits));
    }
    if (hasFinancesEdits(edits)) {
      const f = (await loadFinances()) || {};
      await saveFinances(applyFinancesEdits(f, edits));
    }
    if (hasTimelineEdits(edits)) {
      const t = (await loadTimeline()) || { entries: [] };
      await saveTimeline(applyTimelineEdits(t, edits));
    }
    if (hasShoppingEdits(edits)) {
      const s = await loadShopping();
      await saveShopping(applyShoppingEdits(s, edits));
    }
    if (hasAssetEdits(edits)) {
      const VALID_CATS: AssetItem['category'][] = ['Electronics', 'Bike', 'Sporting', 'Vehicle', 'Jewellery', 'Furniture', 'Other'];
      for (const e of edits) {
        if (e.kind !== 'asset') continue;
        const cat = VALID_CATS.includes(e.category as AssetItem['category'])
          ? (e.category as AssetItem['category'])
          : 'Other';
        const asset: AssetItem = {
          id: Date.now().toString() + Math.floor(Math.random() * 1000),
          name: e.name || 'Unnamed',
          category: cat,
          assignedMember: e.assignedMember || undefined,
          make: e.make || undefined,
          model: e.model || undefined,
          serialNumber: e.serialNumber || undefined,
          purchaseDate: e.purchaseDate || undefined,
          purchasePrice: e.purchasePrice || undefined,
          notes: e.notes || undefined,
          createdAt: new Date().toISOString().slice(0, 10),
        };
        await saveAsset(asset);
      }
    }
  };

  const handleAddDocument = async (memberId: string, docToAdd: FamilyDocument) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, documents: [...m.documents, docToAdd] } : m)));
  };

  const handleDeleteDocument = async (memberId: string, docId: string) => {
    await persistChanges(members.map(m => (m.id === memberId ? { ...m, documents: m.documents.filter(d => d.id !== docId) } : m)));
  };

  const handleUpdateMember = async (updatedMember: FamilyMember) => {
    await persistChanges(members.map(m => (m.id === updatedMember.id ? updatedMember : m)));
  };

  const handleViewDocument = (docToView: FamilyDocument, memberName: string) => {
    setSelectedDocument(docToView);
    setSelectedDocumentMemberName(memberName);
  };

  const handleExportAllData = async () => {
    try {
      const [info, household, finances, timeline, docs] = await Promise.all([
        loadFamilyInfo(),
        loadHousehold(),
        loadFinances(),
        loadTimeline(),
        loadDocuments(),
      ]);

      // Documents: metadata only (no binary content — files live in Cloud Storage)
      const documentsMeta = (docs || []).map(d => ({
        id: d.id,
        name: d.name,
        category: d.category,
        memberId: d.memberId,
        fileName: d.fileName,
        fileType: d.fileType,
        fileSize: d.fileSize,
        uploadedAt: d.uploadedAt,
        uploadedBy: d.uploadedBy,
        storagePath: d.storagePath,
        downloadUrl: d.downloadUrl,
      }));

      const backupData = {
        version: 2,
        exportedAt: new Date().toISOString(),
        author: 'Family Vault backup',
        members,
        calendarEvents: events,
        info: info || null,
        household: household || null,
        finances: finances || null,
        timeline: timeline || null,
        documents: documentsMeta,
        settings,
      };

      const dataStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const exportFileDefaultName = `family_vault_backup_${new Date().toLocaleDateString('en-CA')}.json`;

      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', url);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();

      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      console.error('Export failed:', error);
      showToast('Could not generate the backup file.');
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
          if (backupData.members.length > 0) setSelectedMemberId(backupData.members[0].id);
        }

        if (backupData.calendarEvents && Array.isArray(backupData.calendarEvents)) {
          await handleSaveEvents(backupData.calendarEvents);
        }

        // v2 sections — only restore if present in the backup
        if (backupData.info && typeof backupData.info === 'object') {
          await saveFamilyInfo(backupData.info);
        }
        if (backupData.household && typeof backupData.household === 'object') {
          await saveHousehold(backupData.household);
        }
        if (backupData.finances && typeof backupData.finances === 'object') {
          await saveFinances(backupData.finances);
        }
        if (backupData.timeline && typeof backupData.timeline === 'object') {
          await saveTimeline(backupData.timeline);
        }
        if (backupData.documents && Array.isArray(backupData.documents)) {
          await saveDocuments(backupData.documents);
        }
        if (backupData.settings && typeof backupData.settings === 'object') {
          await saveSettings(backupData.settings);
          setSettings(backupData.settings);
        }

        showToast('Backup imported.');
      } catch (error) {
        console.error('Import failed:', error);
        showToast("Couldn't read that backup file — is it a Family Vault export?");
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const selectedMember = members.find(m => m.id === selectedMemberId);

  // Renewal notices across passports, permits, licenses and visas (real date)
  const expiryWarnings = (() => {
    const today = new Date();
    const items: { memberName: string; label: string; monthsLeft: number; status: 'expired' | 'critical' }[] = [];
    const consider = (memberName: string, label: string, dateStr?: string, horizonMonths = 9) => {
      if (!dateStr) return;
      const expiry = new Date(dateStr);
      if (isNaN(expiry.getTime())) return;
      const diffTime = expiry.getTime() - today.getTime();
      const monthsLeft = Number((Math.ceil(diffTime / (1000 * 60 * 60 * 24)) / 30.4375).toFixed(1));
      if (diffTime < 0) items.push({ memberName, label, monthsLeft, status: 'expired' });
      else if (monthsLeft <= horizonMonths) items.push({ memberName, label, monthsLeft, status: 'critical' });
    };
    members.forEach(m => {
      consider(m.name, 'passport', m.passport?.expiryDate);
      (m.passports || []).forEach(p => consider(m.name, `${p.country || ''} passport`.trim(), p.expiryDate));
      consider(m.name, 'residence permit', m.identity?.residencePermitExpiry);
      consider(m.name, "driver's license", m.identity?.driversLicenseExpiry);
      (m.travel?.visas || []).forEach(v => consider(m.name, `${v.country || ''} visa`.trim(), v.expiryDate, 6));
    });
    return items;
  })();

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
      <div className="min-h-screen bg-cream-100 flex items-center justify-center font-sans">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-clay-500"></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-cream-100 flex items-center justify-center font-sans px-4">
        <div className="card p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-sage-100 flex items-center justify-center mx-auto mb-5">
            <ShieldCheck className="w-8 h-8 text-sage-600" />
          </div>
          <h1 className="font-display text-3xl font-semibold text-ink-900 mb-3">{hubName}</h1>
          <p className="text-sm text-ink-500 leading-relaxed mb-8">
            Sizes, documents, growth and plans for the whole family — together in one private place.
          </p>
          <button onClick={loginWithGoogle} className="btn-primary w-full py-3">
            <LogIn className="w-4 h-4" />
            <span>Sign in with Google</span>
          </button>
          <a href="?demo=1" className="inline-block mt-5 text-xs text-ink-400 underline underline-offset-2 hover:text-ink-600">
            or take a peek at the demo
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-100 text-ink-900 pb-12 font-sans">
      {/* Header */}
      <header className="bg-cream-50/90 backdrop-blur border-b border-cream-300/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => !demo && setIsSettingsOpen(true)}
            className={`flex items-center gap-3 text-left rounded-2xl -m-1 p-1 transition-colors ${demo ? '' : 'hover:bg-cream-200/60 cursor-pointer'}`}
            title={demo ? undefined : 'Hub settings — name &amp; family photo'}
          >
            {settings.familyPhotoUrl ? (
              <div className="w-9 h-9 rounded-2xl overflow-hidden shrink-0 border border-cream-300 shadow-soft">
                <img src={settings.familyPhotoUrl} alt="Family" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-2xl bg-sage-100 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-sage-600" />
              </div>
            )}
            <div>
              <h1 className="font-display text-lg font-semibold text-ink-900 leading-tight">{hubName}</h1>
              <p className="hidden sm:block text-[11px] text-ink-400 font-medium leading-tight">Everything for the family, in one place</p>
            </div>
          </button>

          {/* Main view switcher */}
          <nav className="flex items-center bg-cream-200 p-1 rounded-2xl mx-auto sm:mx-0 overflow-x-auto">
            {VIEWS.filter(view => !(view.id === 'finances' && !canWrite) && !(view.id === 'passwords' && role === 'child')).map(view => (
              <button
                key={view.id}
                type="button"
                onClick={() => setMainView(view.id)}
                className={`tab-pill ${mainView === view.id ? 'tab-pill-active' : ''}`}
              >
                <view.icon className="w-4 h-4" />
                <span className="hidden md:inline">{view.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            {role === 'child' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">View only</span>
            )}
            {role === 'member' && (
              <span className="text-xs bg-sage-100 text-sage-700 rounded-full px-2 py-0.5 font-semibold">Member</span>
            )}

            <div className="relative hidden lg:block">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search the family…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 w-56 border border-cream-300 rounded-xl text-[13px] bg-white text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-clay-300 focus:border-clay-400 transition-all"
              />
            </div>

            {isAdmin && (
              <button onClick={() => setIsAddModalOpen(true)} className="btn-primary px-4 py-2">
                <UserPlus className="w-4 h-4" />
                <span className="hidden sm:inline">Add member</span>
              </button>
            )}

            {familySettingsButton}

            {!demo && (
              <>
                <button onClick={handleExportAllData} className="btn-quiet px-3 py-2" title="Download a backup of everything">
                  <Download className="w-4 h-4" />
                </button>
                <label className="btn-quiet px-3 py-2 cursor-pointer" title="Restore from a backup file">
                  <Upload className="w-4 h-4" />
                  <input type="file" accept="application/json" onChange={handleImportAllData} className="hidden" />
                </label>
                <button onClick={logout} className="btn-quiet px-3 py-2" title="Sign out">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
        {mainView === 'calendar' && (
          <FamilyCalendar members={members} events={events} onSaveEvents={handleSaveEvents} />
        )}

        {mainView === 'assistant' && (
          demo ? <DemoUnavailable label="The assistant" /> : <AIChatbot members={members} onApplyEdits={handleApplyAiEdits} />
        )}

        {mainView === 'info' && <ImportantInfo />}

        {mainView === 'emergency' && <EmergencyView members={members} />}

        {mainView === 'household' && <HouseholdView />}

        {mainView === 'finances' && <FinancesView />}

        {mainView === 'timeline' && <TimelineView />}

        {mainView === 'vault' && (
          demo ? <DemoUnavailable label="The document vault" /> : <DocumentVault members={members} />
        )}

        {mainView === 'shopping' && (
          demo ? <DemoUnavailable label="The shopping list" /> : <ShoppingList />
        )}

        {mainView === 'chat' && (
          demo ? (
            <DemoUnavailable label="Family chat" />
          ) : (
            <FamilyChat members={members} selectedMemberId={selectedMemberId} />
          )
        )}

        {mainView === 'drive' && (
          demo ? <DemoUnavailable label="Drive sync" /> : <GoogleDriveSync />
        )}

        {mainView === 'assets' && (
          demo ? <DemoUnavailable label="Family assets" /> : <Assets />
        )}

        {mainView === 'passwords' && (
          demo ? <DemoUnavailable label="Family passwords" /> : <FamilyPasswords />
        )}

        {mainView === 'profiles' && (
          <>
            {expiryWarnings.length > 0 && (
              <div className="p-4 rounded-3xl bg-honey-50 border border-honey-100 flex items-start gap-3 shadow-soft">
                <div className="p-2 rounded-2xl bg-honey-100 text-honey-700 mt-0.5 shrink-0">
                  <Bell className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[13px] font-bold text-honey-900">Renewals due</h3>
                  <div className="mt-1 space-y-1 text-[13px] text-honey-900/90">
                    {expiryWarnings.map((warning, i) => (
                      <p key={i}>
                        <strong>{warning.memberName}</strong>&apos;s {warning.label} {warning.status === 'expired' ? 'has expired' : `expires in about ${warning.monthsLeft} months`} — worth sorting the renewal.
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {members.length === 0 ? (
              <div className="card text-center py-20 px-6">
                <div className="w-16 h-16 rounded-full bg-clay-50 flex items-center justify-center mx-auto mb-5">
                  <Users className="w-8 h-8 text-clay-400" />
                </div>
                <h2 className="font-display text-2xl font-semibold text-ink-900 mb-2">Welcome to your {hubName}</h2>
                <p className="text-sm text-ink-500 max-w-md mx-auto mb-7">
                  Keep everyone&apos;s clothing sizes, documents, growth history and wish lists in one tidy, private place.
                </p>
                {isAdmin && (
                  <button onClick={() => setIsAddModalOpen(true)} className="btn-primary">
                    <UserPlus className="w-4 h-4" />
                    <span>Add your first family member</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Family directory */}
                <section className="lg:col-span-4 space-y-5">
                  <div className="block lg:hidden">
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                      <input
                        type="text"
                        placeholder="Search the family…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="field pl-10"
                      />
                    </div>
                  </div>

                  <div className="card p-5 space-y-4">
                    <div className="flex items-center justify-between pb-3.5 border-b border-cream-200">
                      <h4 className="section-label">Your family</h4>
                      <span className="chip bg-cream-200 text-ink-600">
                        {members.length} member{members.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {filteredMembers.length === 0 ? (
                      <div className="text-center py-10">
                        <p className="text-[13px] font-medium text-ink-400">No one matches &ldquo;{searchQuery}&rdquo;.</p>
                      </div>
                    ) : searchQuery.trim() !== '' ? (
                      <div className="space-y-2.5">
                        {filteredMembers.map((member) => (
                          <div
                            key={member.id}
                            onClick={() => { setSelectedMemberId(member.id); setDeleteConfirmMemberId(null); }}
                            className={`${cardClass(member)} cursor-pointer`}
                          >
                            {memberCardInner(member)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Reorder.Group axis="y" values={members} onReorder={handleReorder} className="space-y-2.5">
                        {members.map((member) => (
                          <DraggableRow
                            key={member.id}
                            member={member}
                            className={`${cardClass(member)} cursor-pointer`}
                            onSelect={() => { setSelectedMemberId(member.id); setDeleteConfirmMemberId(null); }}
                            onDragEnd={saveOrder}
                            renderInner={memberCardInner}
                          />
                        ))}
                      </Reorder.Group>
                    )}
                  </div>
                </section>

                {/* Selected member detail */}
                <section className="lg:col-span-8 space-y-5">
                  {selectedMember ? (
                    <div className="card overflow-hidden min-h-[500px] flex flex-col">
                      <div className="p-5 sm:p-6 border-b border-cream-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-0">
                          {selectedMember.avatarUrl ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage(selectedMember.avatarUrl!)}
                              className="w-14 h-14 rounded-2xl overflow-hidden border border-cream-300 shadow-soft shrink-0 bg-white cursor-zoom-in"
                              title="View photo"
                            >
                              <img src={selectedMember.avatarUrl} alt={selectedMember.name} className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className={`w-14 h-14 rounded-2xl ${warmAvatarColor(selectedMember.avatarColor)} text-white font-semibold text-xl flex items-center justify-center shadow-soft uppercase shrink-0`}>
                              {selectedMember.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <h2 className="font-display text-2xl font-semibold text-ink-900 flex items-center gap-2.5 flex-wrap">
                              <span className="truncate">{memberName(selectedMember)}</span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setIsEditingProfile(true)}
                                  className="text-[12px] font-sans font-semibold bg-cream-200 hover:bg-cream-300 text-ink-600 px-2.5 py-1 rounded-lg transition-colors cursor-pointer select-none"
                                >
                                  Edit
                                </button>
                              )}
                            </h2>
                            <p className="text-[12px] text-ink-500 font-medium mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="chip bg-cream-200 text-ink-600">{selectedMember.role}</span>
                              {selectedMember.birthdate && (
                                <>
                                  <span className="chip bg-dusk-100 text-dusk-700">{calculateAge(selectedMember.birthdate)}</span>
                                  <span className="text-ink-400">born {selectedMember.birthdate}</span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-1 bg-cream-200 p-1 rounded-2xl w-fit self-start md:self-auto select-none">
                          {TABS.map(tab => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveTab(tab.id)}
                              className={`tab-pill px-3 ${activeTab === tab.id ? 'tab-pill-active' : ''}`}
                            >
                              <tab.icon className={`w-4 h-4 ${tab.id === 'favorites' ? 'fill-rosa-500 text-rosa-500' : ''}`} />
                              <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-5 sm:p-6 flex-1">
                          {/* Enter-only animation: an exit phase can stall in throttled background tabs */}
                          <motion.div
                            key={activeTab + '-' + selectedMember.id}
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            <>
                              {activeTab === 'medical' && (
                                <MemberMedical member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'ids' && (
                                <MemberIDs member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'sizes' && (
                                <MemberSizing member={selectedMember} onUpdateSizes={handleUpdateSizes} />
                              )}
                              {activeTab === 'favorites' && (
                                <MemberFavorites member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                              {activeTab === 'growth' && (
                                <GrowthTracker member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                              {activeTab === 'travel' && (
                                <MemberTravel member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'preferences' && (
                                <MemberPreferences member={selectedMember} onUpdate={handlePatchSelectedMember} />
                              )}
                              {activeTab === 'passport' && (
                                <PassportDetails member={selectedMember} onUpdatePassport={handleUpdatePassport} />
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
                                <SecureSecrets member={selectedMember} onUpdateMember={handleUpdateMember} />
                              )}
                            </>
                          </motion.div>
                      </div>
                    </div>
                  ) : (
                    <div className="card text-center py-24 px-4">
                      <User className="w-10 h-10 text-ink-400/50 mx-auto mb-3" />
                      <h3 className="text-sm font-semibold text-ink-800">No one selected</h3>
                      <p className="text-[13px] text-ink-400 mt-1">Pick a family member from the list to see their things.</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer with honest sync status */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 text-center pb-6">
        <div className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white rounded-full border border-cream-300/70 shadow-soft text-[12px] font-semibold text-ink-500">
          {demo ? (
            <>
              <span className="w-2 h-2 bg-honey-500 rounded-full"></span>
              <span>Demo preview — nothing is saved</span>
            </>
          ) : cloudSynced === false ? (
            <>
              <CloudOff className="w-3.5 h-3.5 text-honey-700" />
              <span>Saved on this device — cloud sync unavailable</span>
            </>
          ) : (
            <>
              <Cloud className="w-3.5 h-3.5 text-sage-600" />
              <span>Private to your Google account{cloudSynced ? ' · synced' : ''}</span>
            </>
          )}
        </div>
      </footer>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 card px-5 py-3 text-[13px] font-semibold text-ink-800 flex items-center gap-2"
          >
            <CloudOff className="w-4 h-4 text-honey-700 shrink-0" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <DocumentViewer
        document={selectedDocument}
        memberName={selectedDocumentMemberName}
        onClose={() => {
          setSelectedDocument(null);
          setSelectedDocumentMemberName('');
        }}
      />

      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddMember}
      />

      <EditMemberModal
        isOpen={isEditingProfile}
        member={selectedMember}
        onClose={() => setIsEditingProfile(false)}
        onSave={handleUpdateMember}
      />

      <HubSettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
    </div>
  );
}

function DemoUnavailable({ label }: { label: string }) {
  return (
    <div className="card text-center py-20 px-6">
      <h3 className="font-display text-xl font-semibold text-ink-900 mb-2">{label} isn&apos;t part of the demo</h3>
      <p className="text-[13px] text-ink-500">Sign in with Google to use it with your own family.</p>
    </div>
  );
}
