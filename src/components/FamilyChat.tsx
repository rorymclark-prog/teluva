import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../utils/firebase';
import { FAMILY_ID } from '../utils/db';
import { useFamilyCtx } from '../contexts/FamilyContext';
import { FamilyMember } from '../types';
import {
  Send,
  Hash,
  Smile,
  Lock,
  Info,
  Users,
  Sparkles,
  MessageCircle,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import EmptyState from './EmptyState';

interface FamilyChatProps {
  members: FamilyMember[];
  selectedMemberId: string;
  isBusinessSpace?: boolean;
}

interface ChatMessage {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderAvatarColor: string;
  createdAt: any;
  channelId: string;
}

const FAMILY_CHANNELS = [
  { id: 'general', name: 'general', desc: 'Main family hub discussions' },
  { id: 'planning', name: 'planning', desc: 'Summer trips & activity schedule' },
  { id: 'shopping', name: 'shopping-list', desc: 'Grocery & supplies coordination' },
  { id: 'emergencies', name: 'emergencies', desc: 'Urgent household updates' }
];

const BUSINESS_CHANNELS = [
  { id: 'general', name: 'general', desc: 'Main team discussions' },
  { id: 'planning', name: 'planning', desc: 'Deadlines, shifts and upcoming work' },
  { id: 'shopping', name: 'supplies', desc: 'Supplies and purchasing coordination' },
  { id: 'emergencies', name: 'urgent', desc: 'Urgent operational updates' },
];

export default function FamilyChat({ members, selectedMemberId, isBusinessSpace = false }: FamilyChatProps) {
  const { isAdmin, canWrite } = useFamilyCtx();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [chatUser, setChatUser] = useState<FamilyMember | null>(null);
  const channels = isBusinessSpace ? BUSINESS_CHANNELS : FAMILY_CHANNELS;

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Who this account posts as. Non-admins always post as their own signed-in
  // identity (no impersonation); admins may post on behalf of a member (e.g. a
  // young child with no login of their own). The Firestore rule pins senderId
  // to the caller's uid regardless, so the label is the only thing the picker
  // changes.
  const ownName = auth.currentUser?.displayName || auth.currentUser?.email || 'Me';

  // Sync default user selection with the parent's selected family member
  useEffect(() => {
    const currentMember = members.find(m => m.id === selectedMemberId);
    if (currentMember) {
      setChatUser(currentMember);
    } else if (members.length > 0) {
      setChatUser(members[0]);
    }
  }, [selectedMemberId, members]);

  // Subscribe to real-time chat messages — scoped to the signed-in user
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      // No authenticated user — show empty / loading cleared state
      setMessages([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    // Shared household path: families/{FAMILY_ID}/messages
    const messagesRef = collection(db, 'families', FAMILY_ID, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs: ChatMessage[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: data.text || '',
          senderId: data.senderId || '',
          senderName: data.senderName || 'Anonymous',
          senderAvatarColor: data.senderAvatarColor || 'bg-ink-400',
          createdAt: data.createdAt,
          channelId: data.channelId || 'general'
        });
      });
      setMessages(msgs);
      setIsLoading(false);
      setLoadError(null);

      // Scroll to bottom on load/new message
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
      // Clear the spinner and show a real message instead of spinning forever
      setIsLoading(false);
      setLoadError(`Couldn't load the ${isBusinessSpace ? 'team' : 'family'} chat. Check your connection and refresh.`);
    });

    return () => unsubscribe();
  // Re-subscribe if the Firebase auth user changes
  }, [auth.currentUser?.uid]);

  // Scroll to bottom whenever messages list or active channel changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!canWrite) { setSendError('Your account is view-only, so you can’t post here.'); return; }

    // Admins may post as a chosen member; everyone else posts as themselves.
    const asMember = isAdmin ? chatUser : null;
    const senderName = asMember?.name || ownName;
    const senderAvatarColor = asMember?.avatarColor || 'bg-clay-500';

    const messageText = inputText.trim();
    setInputText('');
    setSendError(null);

    try {
      // Write to the shared household messages sub-collection.
      // senderId MUST be our own uid — the Firestore rule enforces it.
      await addDoc(collection(db, 'families', FAMILY_ID, 'messages'), {
        text: messageText,
        senderId: uid,
        senderName,
        senderAvatarColor,
        channelId: activeChannel,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
      setInputText(messageText); // don't lose what they typed
      setSendError("Message didn't send — check your connection and try again.");
    }
  };

  const channelMessages = messages.filter(m => m.channelId === activeChannel);

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="card overflow-hidden h-[600px] flex flex-col font-sans">
      {/* Upper header section */}
      <div className="p-4 bg-white border-b border-cream-200 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-cream-100 border border-cream-300 text-ink-800">
            <MessageCircle className="w-5 h-5 text-ink-700" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
              Family Messenger
              <span className="chip bg-sage-100 text-sage-700 border border-sage-200">
                Real-time
              </span>
            </h2>
            <p className="text-[13px] font-semibold text-ink-500 mt-0.5">
              Post to channels or coordinate planning in real-time
            </p>
          </div>
        </div>

        {/* Sender identity. Admins can post on behalf of a member (e.g. a young
            child); everyone else posts as themselves — no impersonation. */}
        <div className="flex items-center space-x-2">
          <label className="field-label mb-0">Posting as:</label>
          {isAdmin ? (
            <select
              value={chatUser?.id || ''}
              onChange={(e) => {
                const u = members.find(m => m.id === e.target.value);
                setChatUser(u || null);
              }}
              className="text-xs font-semibold px-2.5 py-1.5 bg-cream-100 border border-cream-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-clay-300 cursor-pointer text-ink-800"
            >
              <option value="">{ownName} (you)</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.role})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs font-semibold px-2.5 py-1.5 bg-cream-100 border border-cream-300 rounded-xl text-ink-800">
              {ownName}
            </span>
          )}
        </div>
      </div>

      {/* Main chat layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation panel */}
        <div className="w-60 border-r border-cream-200 bg-cream-50 p-4 flex flex-col justify-between hidden md:flex">
          <div className="space-y-4">
            <h3 className="section-label px-2">
              Family Channels
            </h3>
            <div className="space-y-1">
              {channels.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id)}
                  className={`w-full flex items-center space-x-2 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                    activeChannel === ch.id
                      ? 'bg-ink-800 text-white shadow-soft'
                      : 'text-ink-600 hover:bg-cream-200 hover:text-ink-800'
                  }`}
                >
                  <Hash className={`w-3.5 h-3.5 shrink-0 ${activeChannel === ch.id ? 'text-white' : 'text-ink-400'}`} />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-white border border-cream-300 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 section-label">
              <Lock className="w-3 h-3 text-sage-500" />
              <span>Private</span>
            </div>
            <p className="text-[13px] text-ink-400 font-light">
              Only signed-in members of {isBusinessSpace ? 'this business' : 'your family'} can read or post here.
            </p>
          </div>
        </div>

        {/* Message board body */}
        <div className="flex-1 flex flex-col bg-white min-w-0">
          {/* Mobile channel selector — the sidebar is hidden below md */}
          <div className="md:hidden flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-cream-200 bg-cream-50">
            {channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => setActiveChannel(ch.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-all ${
                  activeChannel === ch.id
                    ? 'bg-ink-800 text-white'
                    : 'bg-white border border-cream-300 text-ink-600'
                }`}
              >
                <Hash className="w-3 h-3 shrink-0" />
                {ch.name}
              </button>
            ))}
          </div>
          {/* Active channel summary banner */}
          <div className="px-5 py-2.5 bg-cream-50 border-b border-cream-200 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-ink-800 flex items-center gap-1 text-[13px]">
                <Hash className="w-3.5 h-3.5 text-ink-400 inline" />
                {channels.find(c => c.id === activeChannel)?.name}
              </span>
              <span className="text-[13px] text-ink-400 font-light hidden sm:inline">
                — {channels.find(c => c.id === activeChannel)?.desc}
              </span>
            </div>
            <div className="flex items-center space-x-1 text-[13px] text-ink-400 font-semibold">
              <Users className="w-3 h-3" />
              <span>{members.length} members</span>
            </div>
          </div>

          {/* Messages pane */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {isLoading ? (
              <div className="h-full flex items-center justify-center flex-col space-y-2">
                <div className="w-6 h-6 border-2 border-ink-800 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-[13px] font-semibold text-ink-400">Loading messages…</p>
              </div>
            ) : loadError ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
                <div className="w-10 h-10 rounded-2xl bg-rosa-50 text-rosa-600 flex items-center justify-center">
                  <Info className="w-5 h-5" />
                </div>
                <p className="text-[13px] text-rosa-600 max-w-xs font-medium">{loadError}</p>
              </div>
            ) : channelMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  icon={Hash}
                  title="No messages yet"
                  description={`Be the first to post a note or checklist in #${channels.find(c => c.id === activeChannel)?.name}!`}
                />
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {channelMessages.map((msg, idx) => {
                  const isOwn = msg.senderId === auth.currentUser?.uid || (chatUser && msg.senderId === chatUser.id);
                  const formattedTime = msg.createdAt?.seconds
                    ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  const senderMember = members.find(m => m.id === msg.senderId || m.name === msg.senderName);

                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex items-start gap-3 max-w-[85%] ${isOwn ? 'ml-auto flex-row-reverse' : ''}`}
                    >
                      {/* Avatar */}
                      {senderMember?.avatarUrl ? (
                        <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0 border border-cream-300 relative bg-white shadow-soft">
                          <img src={senderMember.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-8 h-8 rounded-xl ${msg.senderAvatarColor} text-white font-bold text-[10px] flex items-center justify-center shrink-0 shadow-soft uppercase`}>
                          {getInitials(msg.senderName)}
                        </div>
                      )}

                      {/* Msg Details */}
                      <div className="space-y-1">
                        <div className={`flex items-center gap-2 ${isOwn ? 'justify-end' : ''}`}>
                          <span className="text-[12px] font-semibold text-ink-600">{msg.senderName}</span>
                          <span className="text-[11px] font-mono tabular-nums text-ink-400 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {formattedTime}
                          </span>
                        </div>
                        <div className={`p-3 rounded-2xl text-[13px] leading-relaxed ${
                          isOwn
                            ? 'bg-gradient-to-br from-clay-500 to-clay-600 text-white rounded-tr-sm'
                            : 'bg-white text-ink-800 border border-cream-300 rounded-tl-sm'
                        }`}>
                          <p>{msg.text}</p>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Form Entry Field */}
          <div className="p-4 bg-white border-t border-cream-200">
            {sendError && (
              <p className="text-[12px] text-rosa-600 font-medium mb-2">{sendError}</p>
            )}
            <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder={
                  !canWrite ? 'Your account is view-only'
                  : isAdmin && chatUser ? `Post as ${chatUser.name}…`
                  : 'Write a message…'
                }
                disabled={!canWrite || !auth.currentUser}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="field flex-1 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || !canWrite || !auth.currentUser}
                className="btn-primary px-3 py-2.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
