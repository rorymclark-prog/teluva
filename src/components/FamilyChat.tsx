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

interface FamilyChatProps {
  members: FamilyMember[];
  selectedMemberId: string;
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

const CHANNELS = [
  { id: 'general', name: 'general', desc: 'Main family hub discussions' },
  { id: 'planning', name: 'planning', desc: 'Summer trips & activity schedule' },
  { id: 'shopping', name: 'shopping-list', desc: 'Grocery & supplies coordination' },
  { id: 'emergencies', name: 'emergencies', desc: 'Urgent household updates' }
];

export default function FamilyChat({ members, selectedMemberId }: FamilyChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState('general');
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [chatUser, setChatUser] = useState<FamilyMember | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Sync default user selection with the parent's selected family member
  useEffect(() => {
    const currentMember = members.find(m => m.id === selectedMemberId);
    if (currentMember) {
      setChatUser(currentMember);
    } else if (members.length > 0) {
      setChatUser(members[0]);
    }
  }, [selectedMemberId, members]);

  // Subscribe to real-time chat messages
  useEffect(() => {
    setIsLoading(true);
    const messagesRef = collection(db, 'messages');
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
          senderAvatarColor: data.senderAvatarColor || 'bg-gray-400',
          createdAt: data.createdAt,
          channelId: data.channelId || 'general'
        });
      });
      setMessages(msgs);
      setIsLoading(false);
      
      // Scroll to bottom on load/new message
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'messages');
    });

    return () => unsubscribe();
  }, []);

  // Scroll to bottom whenever messages list or active channel changes
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !chatUser) return;

    const messageText = inputText.trim();
    setInputText('');

    try {
      // In our secure setup, anyone can participate utilizing their identified profile
      await addDoc(collection(db, 'messages'), {
        text: messageText,
        senderId: auth.currentUser?.uid || chatUser.id,
        senderName: chatUser.name,
        senderAvatarColor: chatUser.avatarColor,
        channelId: activeChannel,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'messages');
    }
  };

  const channelMessages = messages.filter(m => m.channelId === activeChannel);

  const getInitials = (name: string) => {
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="bg-white border border-gray-150 rounded-2xl shadow-xs overflow-hidden h-[600px] flex flex-col font-sans">
      {/* Upper header section */}
      <div className="p-4 bg-white border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-900">
            <MessageCircle className="w-5 h-5 text-gray-800" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 tracking-tight flex items-center gap-1.5">
              Secure Family Messenger
              <span className="text-[10px] bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                Real-Time
              </span>
            </h2>
            <p className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider font-bold">
              Post to channels or coordinate planning in real-time
            </p>
          </div>
        </div>

        {/* Selected sender simulator switch */}
        <div className="flex items-center space-x-2">
          <label className="text-[10px] font-bold text-gray-450 uppercase tracking-wider">
            Posting as:
          </label>
          <select
            value={chatUser?.id || ''}
            onChange={(e) => {
              const u = members.find(m => m.id === e.target.value);
              if (u) setChatUser(u);
            }}
            className="text-xs font-semibold px-2.5 py-1.5 bg-gray-50 border border-gray-150 rounded-xl focus:outline-none cursor-pointer"
          >
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main chat layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation panel */}
        <div className="w-60 border-r border-gray-100 bg-gray-50/50 p-4 flex flex-col justify-between hidden md:flex">
          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">
              Family Channels
            </h3>
            <div className="space-y-1">
              {CHANNELS.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => setActiveChannel(ch.id)}
                  className={`w-full flex items-center space-x-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    activeChannel === ch.id
                      ? 'bg-gray-950 text-white shadow-xs'
                      : 'text-gray-650 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Hash className={`w-3.5 h-3.5 shrink-0 ${activeChannel === ch.id ? 'text-white' : 'text-gray-450'}`} />
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 bg-white border border-gray-150 rounded-xl space-y-1.5">
            <div className="flex items-center space-x-1.5 text-[9px] font-bold text-gray-450 uppercase tracking-wider">
              <Lock className="w-3 h-3 text-emerald-500" />
              <span>Vault Managed</span>
            </div>
            <p className="text-[10px] text-gray-400 font-light">
              This feed is synced atomically across shared databases securely.
            </p>
          </div>
        </div>

        {/* Message board body */}
        <div className="flex-1 flex flex-col bg-white">
          {/* Active channel summary banner */}
          <div className="px-5 py-2.5 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-gray-900 flex items-center gap-1 text-xs">
                <Hash className="w-3.5 h-3.5 text-gray-450 inline" />
                {CHANNELS.find(c => c.id === activeChannel)?.name}
              </span>
              <span className="text-[10px] text-gray-400 font-light hidden sm:inline">
                — {CHANNELS.find(c => c.id === activeChannel)?.desc}
              </span>
            </div>
            <div className="flex items-center space-x-1 text-[9px] text-gray-400 font-bold uppercase tracking-wider">
              <Users className="w-3 h-3" />
              <span>{members.length} members sharing</span>
            </div>
          </div>

          {/* Messages pane */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {isLoading ? (
              <div className="h-full flex items-center justify-center flex-col space-y-2">
                <div className="w-6 h-6 border-2 border-gray-800 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Synchronizing Family Thread...</p>
              </div>
            ) : channelMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-gray-50 text-gray-450 flex items-center justify-center border border-gray-100">
                  <Hash className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">No messages yet</h4>
                  <p className="text-xs text-gray-400 max-w-xs font-light">
                    Be the first to post a note or checklist in #{CHANNELS.find(c => c.id === activeChannel)?.name}!
                  </p>
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {channelMessages.map((msg, idx) => {
                  const isOwn = msg.senderId === auth.currentUser?.uid || (chatUser && msg.senderId === chatUser.id);
                  const isChild = msg.senderName === 'Leo' || msg.senderName === 'Mia';
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
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-gray-150 relative bg-white shadow-xs">
                          <img src={senderMember.avatarUrl} alt={msg.senderName} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className={`w-8 h-8 rounded-lg ${msg.senderAvatarColor} text-white font-bold text-[10px] flex items-center justify-center shrink-0 shadow-xs uppercase`}>
                          {getInitials(msg.senderName)}
                        </div>
                      )}

                      {/* Msg Details */}
                      <div className="space-y-1">
                        <div className={`flex items-center gap-2 text-[10px] text-gray-400 font-bold uppercase tracking-wider ${isOwn ? 'justify-end' : ''}`}>
                          <span className="text-gray-700 lowercase font-extrabold">{msg.senderName}</span>
                          <span className="font-light tracking-tight flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5 text-gray-300" />
                            {formattedTime}
                          </span>
                        </div>
                        <div className={`p-3 rounded-xl border text-xs leading-relaxed ${
                          isOwn 
                            ? 'bg-gray-950 text-white border-gray-900 rounded-tr-none' 
                            : 'bg-gray-50 text-gray-900 border-gray-150 rounded-tl-none'
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
          <div className="p-4 bg-white border-t border-gray-100">
            <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder={chatUser ? `Post message as ${chatUser.name}...` : "Select posting profile to type..."}
                disabled={!chatUser}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 px-4 py-2.5 border border-gray-250 rounded-xl text-xs focus:ring-1 focus:ring-gray-900 focus:outline-none focus:border-gray-900 placeholder:text-gray-400"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-2.5 rounded-xl bg-gray-950 hover:bg-black text-white shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
