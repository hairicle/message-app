'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import * as filesApi from '../lib/api/files';
import * as messagesApi from '../lib/api/messages';
import type {
  BookmarkedMessage,
  Conversation,
  FileMeta,
  Message,
  MessageDeleteResult,
  MessageEditResult,
  MessageType,
  PinnedMessage,
  Reaction,
} from '@messenger/shared';
import { ConversationInfoPanel } from './ConversationInfoPanel';
import { Lightbox } from './Lightbox';
import { MessageAttachment } from './MessageAttachment';
import { Linkify } from './Linkify';
import { useConfirm } from './ConfirmDialog';
import { Avatar } from './ui';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { decodeMessageText, encodeMessageText } from '../utils/text';
import { FaBookmark, FaCheck, FaChevronDown, FaChevronLeft, FaImage, FaMagnifyingGlass, FaMicrophone, FaPaperPlane, FaPaperclip, FaPen, FaPhone, FaRegBookmark, FaRegCopy, FaReply, FaShare, FaThumbtack, FaTrash, FaVideo, FaXmark } from 'react-icons/fa6';
import { attachmentNoun } from '../utils/messagePreview';
import { groupingFor } from '../utils/messageGrouping';

function attachmentTypeForMime(mimeType: string): MessageType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

interface MessageThreadProps {
  conversationId: string;
  presence: Record<string, 'online' | 'offline'>;
  onBack?: () => void;
}

export function addMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  const newTime = new Date(message.createdAt).getTime();
  const insertAt = messages.findIndex((m) => new Date(m.createdAt).getTime() > newTime);
  if (insertAt === -1) return [...messages, message];
  return [...messages.slice(0, insertAt), message, ...messages.slice(insertAt)];
}

export function MessageThread({ conversationId, presence, onBack }: MessageThreadProps) {
  const { user } = useAuth();
  const socket = useSocket();
  const { confirm, confirmDialog } = useConfirm();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [readReceipts, setReadReceipts] = useState<Record<string, Set<string>>>({});
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<{ file: FileMeta; type: MessageType } | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [showPinnedBar, setShowPinnedBar] = useState(false);
  const [pinnedBarTab, setPinnedBarTab] = useState<'pinned' | 'saved'>('pinned');
  const [pinnedBarIndex, setPinnedBarIndex] = useState(0);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');
  const [forwardSelected, setForwardSelected] = useState<Set<string>>(new Set());
  const [forwardComment, setForwardComment] = useState('');
  const [forwardLoading, setForwardLoading] = useState(false);
  const [allConversations, setAllConversations] = useState<Conversation[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<{ callId: string; type: 'audio' | 'video' } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ callId: string; initiatorId: string; type: string } | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const QUICK_EMOJIS = ['👍', '❤️', '😂', '😢', '🔥'];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Per-message toolbar direction computed fresh on each hover/click
  const [msgDirs, setMsgDirs] = useState<Record<string, 'up' | 'down'>>({});
  const typingTimeoutRef = useRef<number | null>(null);
  const markedReadRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    let cancelled = false;
    markedReadRef.current = new Set();
    setMessages([]);
    setConversation(null);
    setReadReceipts({});
    setTypingUsers(new Set());

    conversationsApi.getConversation(conversationId).then(({ conversation }) => {
      if (!cancelled) setConversation(conversation);
    }).catch(() => {});

    messagesApi.listMessages(conversationId).then(({ messages }) => {
      // Backend already returns oldest → newest (ORDER BY created_at DESC, then reversed server-side)
      if (!cancelled) setMessages(messages);
    }).catch(() => {});

    messagesApi.getPinnedMessages(conversationId).then(({ pinned }) => {
      if (!cancelled) {
        setPinnedMessages(pinned);
        setPinnedIds(new Set(pinned.map((p) => p.messageId)));
      }
    }).catch(() => {});

    messagesApi.getUserBookmarks(conversationId).then(({ bookmarks: bk }) => {
      if (!cancelled) {
        setBookmarks(bk);
        setBookmarkIds(new Set(bk.map((b) => b.messageId)));
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (!socket || !user) return;

    const handleNewMessage = (message: Message) => {
      if (message.conversationId !== conversationId) return;
      setMessages((prev) => addMessage(prev, message));
    };
    const handleTypingStart = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId !== conversationId || payload.userId === user.id) return;
      setTypingUsers((prev) => new Set(prev).add(payload.userId));
    };
    const handleTypingStop = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId !== conversationId) return;
      setTypingUsers((prev) => { const next = new Set(prev); next.delete(payload.userId); return next; });
    };
    const handleMessageRead = (payload: { messageId: string; userId: string }) => {
      setReadReceipts((prev) => {
        const set = new Set(prev[payload.messageId] ?? []);
        set.add(payload.userId);
        return { ...prev, [payload.messageId]: set };
      });
    };
    const handleMessageEdited = (payload: MessageEditResult) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => m.id === payload.id ? { ...m, ciphertext: payload.ciphertext, editedAt: payload.editedAt } : m));
    };
    const handleMessageDeleted = (payload: MessageDeleteResult) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => m.id === payload.id ? { ...m, ciphertext: '', file: undefined, deletedAt: payload.deletedAt } : m));
    };
    const handleReactionAdded = (payload: { messageId: string; conversationId: string } & Reaction) => {
      if (payload.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => {
        if (m.id !== payload.messageId) return m;
        const reactions = (m.reactions ?? []).filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji));
        return { ...m, reactions: [...reactions, { emoji: payload.emoji, userId: payload.userId, username: payload.username, displayName: payload.displayName }] };
      }));
    };
    const handleReactionRemoved = (payload: { messageId: string; userId: string; emoji: string }) => {
      setMessages((prev) => prev.map((m) => m.id !== payload.messageId ? m : { ...m, reactions: (m.reactions ?? []).filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji)) }));
    };
    const handleCallIncoming = (payload: { callId: string; initiatorId: string; type: string; conversationId: string }) => {
      if (payload.conversationId !== conversationId) return;
      setIncomingCall({ callId: payload.callId, initiatorId: payload.initiatorId, type: payload.type });
    };
    const handleCallEnded = () => {
      setActiveCall(null); setIncomingCall(null);
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
      if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);
    socket.on('message:read', handleMessageRead);
    socket.on('message:edited', handleMessageEdited);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('reaction:added', handleReactionAdded);
    socket.on('reaction:removed', handleReactionRemoved);
    socket.on('call:incoming', handleCallIncoming);
    socket.on('call:ended', handleCallEnded);

    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      socket.off('message:read', handleMessageRead);
      socket.off('message:edited', handleMessageEdited);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('reaction:added', handleReactionAdded);
      socket.off('reaction:removed', handleReactionRemoved);
      socket.off('call:incoming', handleCallIncoming);
      socket.off('call:ended', handleCallEnded);
    };
  }, [socket, conversationId, user]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (!socket || !user) return;
    for (const message of messages) {
      if (message.senderId !== user.id && !markedReadRef.current.has(message.id)) {
        markedReadRef.current.add(message.id);
        socket.emit('message:read', { messageId: message.id });
      }
    }
  }, [socket, user, messages]);

  function handleInputChange(value: string) {
    setInput(value);
    if (!socket) return;
    socket.emit('typing:start', { conversationId });
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => { socket.emit('typing:stop', { conversationId }); }, 2000);
  }

  async function dispatchMessage(payload: { conversationId: string; type?: MessageType; ciphertext?: string; fileId?: string; replyToMessageId?: string }) {
    if (socket) {
      socket.emit('message:send', payload, (res: { ok: boolean; message?: Message; error?: string }) => {
        if (res.ok && res.message) setMessages((prev) => addMessage(prev, res.message!));
      });
    } else {
      const { message } = await messagesApi.sendMessage(payload);
      setMessages((prev) => addMessage(prev, message));
    }
  }

  function startEdit(message: Message) { setEditingMessageId(message.id); setEditingText(decodeMessageText(message.ciphertext)); }
  function cancelEdit() { setEditingMessageId(null); setEditingText(''); }

  async function submitEdit(messageId: string) {
    const ciphertext = encodeMessageText(editingText.trim());
    cancelEdit();
    if (socket) {
      socket.emit('message:edit', { messageId, ciphertext }, (res: { ok: boolean; error?: string }) => { if (!res.ok) window.alert(res.error ?? 'Failed to edit message'); });
    } else {
      const { message } = await messagesApi.editMessage(messageId, ciphertext);
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, ciphertext: message.ciphertext, editedAt: message.editedAt } : m));
    }
  }

  async function handleDelete(messageId: string) {
    const ok = await confirm({
      title: 'Delete this message?',
      description: <>The message will be removed for everyone in this conversation. <b style={{ color: 'var(--text-muted)' }}>This cannot be undone.</b></>,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!ok) return;
    if (socket) {
      socket.emit('message:delete', { messageId }, (res: { ok: boolean; error?: string }) => { if (!res.ok) window.alert(res.error ?? 'Failed to delete message'); });
    } else {
      const { message } = await messagesApi.deleteMessage(messageId);
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, ciphertext: '', file: undefined, deletedAt: message.deletedAt } : m));
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    socket?.emit('typing:stop', { conversationId });
    await dispatchMessage({ conversationId, ciphertext: encodeMessageText(text), replyToMessageId: replyingTo?.id });
    setReplyingTo(null);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const { file: fileMeta } = await filesApi.uploadFile(file, file.name);
      await dispatchMessage({ conversationId, type: attachmentTypeForMime(file.type), fileId: fileMeta.id, replyToMessageId: replyingTo?.id });
      setReplyingTo(null);
    } finally { setUploading(false); }
  }

  async function startRecording() {
    const replyToId = replyingTo?.id;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        setUploading(true);
        try {
          const { file: fileMeta } = await filesApi.uploadFile(blob, 'voice-note.webm');
          await dispatchMessage({ conversationId, type: 'audio', fileId: fileMeta.id, replyToMessageId: replyToId });
          setReplyingTo(null);
        } finally { setUploading(false); }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch { window.alert('Microphone access is required to record a voice note.'); }
  }

  function stopRecording() { mediaRecorderRef.current?.stop(); mediaRecorderRef.current = null; setIsRecording(false); }

  function toggleReaction(messageId: string, emoji: string) {
    const msg = messages.find((m) => m.id === messageId);
    const myExisting = (msg?.reactions ?? []).find((r) => r.userId === user!.id);

    if (myExisting?.emoji === emoji) {
      // Same emoji → remove (toggle off)
      setMessages((prev) => prev.map((m) =>
        m.id !== messageId ? m : {
          ...m, reactions: (m.reactions ?? []).filter((r) => r.userId !== user!.id),
        }
      ));
      messagesApi.removeReaction(messageId, emoji).catch(() => {
        setMessages((prev) => prev.map((m) =>
          m.id !== messageId ? m : { ...m, reactions: [...(m.reactions ?? []), myExisting] }
        ));
      });
    } else {
      // Different emoji or no reaction → replace (remove old, add new)
      const optimistic = { emoji, userId: user!.id, username: user!.username, displayName: user!.displayName };
      setMessages((prev) => prev.map((m) =>
        m.id !== messageId ? m : {
          ...m, reactions: [...(m.reactions ?? []).filter((r) => r.userId !== user!.id), optimistic],
        }
      ));
      // Remove old reaction first if there was one, then add new
      const addNew = () => messagesApi.addReaction(messageId, emoji).catch(() => {
        setMessages((prev) => prev.map((m) =>
          m.id !== messageId ? m : {
            ...m, reactions: (m.reactions ?? []).filter((r) => r.userId !== user!.id),
          }
        ));
      });
      if (myExisting) {
        messagesApi.removeReaction(messageId, myExisting.emoji).then(addNew).catch(addNew);
      } else {
        addNew();
      }
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const { results } = await messagesApi.searchMessages(searchQuery, conversationId);
    setSearchResults(results.reverse());
  }

  async function startCall(type: 'audio' | 'video') {
    if (!socket) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      localStreamRef.current = stream;
      socket.emit('call:start', { conversationId, type }, (res: { ok: boolean; call?: { id: string }; error?: string }) => {
        if (!res.ok || !res.call) { window.alert(res.error ?? 'Failed to start call'); return; }
        setActiveCall({ callId: res.call.id, type });
      });
    } catch { window.alert('Microphone/camera access required for calls.'); }
  }

  async function answerCall() {
    if (!incomingCall || !socket) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setActiveCall({ callId: incomingCall.callId, type: 'audio' });
      setIncomingCall(null);
    } catch { window.alert('Microphone access required.'); }
  }

  function rejectCall() {
    if (!incomingCall || !socket) return;
    socket.emit('call:reject', { callId: incomingCall.callId, initiatorUserId: incomingCall.initiatorId });
    setIncomingCall(null);
  }

  function endCall() {
    if (!activeCall || !socket) return;
    socket.emit('call:end', { callId: activeCall.callId });
    setActiveCall(null);
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
  }

  async function handlePin(message: Message) {
    const isPinned = pinnedIds.has(message.id);
    try {
      if (isPinned) {
        await messagesApi.unpinMessage(message.id);
        setPinnedIds((prev) => { const s = new Set(prev); s.delete(message.id); return s; });
        setPinnedMessages((prev) => prev.filter((p) => p.messageId !== message.id));
      } else {
        await messagesApi.pinMessage(message.id);
        const sender = conversation?.members?.find((m) => m.user_id === message.senderId);
        const newPin: PinnedMessage = {
          messageId: message.id,
          type: message.type,
          ciphertext: message.ciphertext,
          senderDisplayName: sender?.display_name ?? 'Unknown',
          pinnedAt: new Date().toISOString(),
          pinnedByName: user!.displayName,
        };
        setPinnedIds((prev) => new Set([...prev, message.id]));
        setPinnedMessages((prev) => [newPin, ...prev]);
      }
    } catch (err) { window.alert((err as Error).message); }
  }

  async function handleBookmark(message: Message) {
    const isSaved = bookmarkIds.has(message.id);
    try {
      if (isSaved) {
        await messagesApi.unbookmarkMessage(message.id);
        setBookmarkIds((prev) => { const s = new Set(prev); s.delete(message.id); return s; });
        setBookmarks((prev) => prev.filter((b) => b.messageId !== message.id));
      } else {
        await messagesApi.bookmarkMessage(message.id);
        const sender = conversation?.members?.find((m) => m.user_id === message.senderId);
        setBookmarkIds((prev) => new Set([...prev, message.id]));
        setBookmarks((prev) => [{
          messageId: message.id,
          type: message.type,
          ciphertext: message.ciphertext,
          senderDisplayName: sender?.display_name ?? 'Unknown',
          savedAt: new Date().toISOString(),
        }, ...prev]);
      }
    } catch (err) { window.alert((err as Error).message); }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function openForwardPicker(message: Message) {
    setForwardingMessage(message);
    setForwardSearch('');
    setForwardSelected(new Set());
    setForwardComment('');
    // Load conversations fresh when picker opens
    conversationsApi.listConversations().then(({ conversations }) => {
      setAllConversations(conversations.filter((c) => c.id !== conversationId));
    }).catch(() => {});
  }

  async function handleForward() {
    if (!forwardingMessage || forwardSelected.size === 0) return;
    setForwardLoading(true);
    const targets = allConversations.filter((c) => forwardSelected.has(c.id));
    try {
      await Promise.all(targets.map((c) => messagesApi.forwardMessage(forwardingMessage.id, c.id)));
      // Send optional comment to each target
      if (forwardComment.trim()) {
        const ciphertext = encodeMessageText(forwardComment.trim());
        await Promise.all(targets.map((c) =>
          messagesApi.sendMessage({ conversationId: c.id, ciphertext })
        ));
      }
      const names = targets.map((c) => getConversationTitle(c, user!.id)).join(', ');
      showToast(`Forwarded to ${names}`);
      setForwardingMessage(null);
    } catch (err) { window.alert((err as Error).message); }
    finally { setForwardLoading(false); }
  }

  function scrollToMessage(messageId: string) {
    const el = msgRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setHighlightedMsgId(messageId);
    setTimeout(() => setHighlightedMsgId(null), 1800);
  }

  // Compute toolbar open direction for a given element freshly each call
  function calcToolbarDir(el: Element, msgId: string) {
    const rect = el.getBoundingClientRect();
    const containerRect = scrollContainerRef.current?.getBoundingClientRect();
    const containerBottom = containerRect?.bottom ?? window.innerHeight;
    const spaceBelow = containerBottom - rect.bottom - 68; // 68 ≈ composer bar height
    const dir: 'up' | 'down' = spaceBelow >= 220 ? 'down' : 'up';
    setMsgDirs((prev) => ({ ...prev, [msgId]: dir }));
    return dir;
  }

  if (!conversation) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-dim)' }}>Loading conversation...</div>;
  }

  const title = getConversationTitle(conversation, user!.id);
  const other = conversation.type === 'direct' ? getOtherMember(conversation, user!.id) : null;
  const isOnline = other ? presence[other.user_id] === 'online' : false;
  const isTyping = typingUsers.size > 0;
  const isGroup = conversation.type !== 'direct';
  const membersById = new Map((conversation.members ?? []).map((m) => [m.user_id, m]));
  const messagesById = new Map(messages.map((m) => [m.id, m]));

  return (
    // Row, so the info panel can sit beside the thread on wide screens and the conversation
    // reflows into the remaining width instead of being covered by it.
    <div className="relative flex h-full overflow-hidden">
      <div className="relative flex flex-col flex-1 min-w-0 h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 flex-shrink-0" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        {onBack && (
          <button onClick={onBack} className="lg:hidden p-2 -ml-1 rounded-xl transition-colors flex-shrink-0 btn-icon" aria-label="Back">
            <FaChevronLeft size={14} />
          </button>
        )}
        <button type="button" onClick={() => setShowInfoPanel(true)} className="flex items-center gap-3 flex-1 min-w-0 rounded-xl -mx-2 px-2 py-1 transition-colors text-left hover-panel-alt">
          <Avatar name={title} avatarUrl={other?.avatar_url} size={36} radius={8} fontSize={14} />
          <div className="flex-1 min-w-0">
            <h2 className="text-[18px] font-semibold leading-tight truncate" style={{ color: 'var(--text)' }}>{title}</h2>
            <div className="text-[13.5px] leading-tight mt-0.5 font-mono">
              {isTyping ? (
                <span className="italic" style={{ color: 'var(--accent)' }}>typing...</span>
              ) : other ? (
                <span style={{ color: isOnline ? 'var(--accent)' : 'var(--text-dim)', fontWeight: isOnline ? 500 : 400 }}>
                  {isOnline ? '● Online' : '○ Offline'}
                </span>
              ) : isGroup ? (
                <span style={{ color: 'var(--text-dim)' }}>{conversation.members?.length ?? 0} members</span>
              ) : null}
            </div>
          </div>
        </button>
        <button type="button" onClick={() => setSearchOpen((v) => !v)} className="p-2 rounded-xl transition-colors flex-shrink-0 btn-icon" title="Search messages">
          <FaMagnifyingGlass size={14} />
        </button>
        {/* Call buttons — hidden, re-enable by changing false → true when calling is ready */}
        {false && (activeCall ? (
          <button type="button" onClick={endCall} className="px-3 py-1.5 rounded-xl text-xs font-mono font-medium flex items-center gap-1 flex-shrink-0" style={{ background: 'var(--danger)', color: '#fff' }}>
            <span className="animate-pulse">●</span> End call
          </button>
        ) : (
          <>
            <button type="button" onClick={() => startCall('audio')} className="p-2 rounded-xl transition-colors flex-shrink-0 btn-icon" title="Audio call">
              <FaPhone size={16} />
            </button>
            <button type="button" onClick={() => startCall('video')} className="p-2 rounded-xl transition-colors flex-shrink-0 btn-icon" title="Video call">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </button>
          </>
        ))}
      </header>

      {/* Search bar */}
      {searchOpen && (
        <form onSubmit={handleSearch} className="flex gap-2 px-4 py-2 flex-shrink-0" style={{ background: 'var(--panel-alt)', borderBottom: '1px solid var(--border)' }}>
          <input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            placeholder="Search messages in this conversation…" className="flex-1 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <button type="submit" className="px-3 py-1.5 rounded-lg text-sm font-mono" style={{ background: 'var(--accent)', color: '#fff' }}>Search</button>
          <button type="button" onClick={() => { setSearchOpen(false); setSearchResults(null); setSearchQuery(''); }}
            className="px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>✕</button>
        </form>
      )}

      {/* Incoming call banner — hidden, re-enable when calling is ready */}
      {false && incomingCall && (
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: 'var(--accent-wash)', borderBottom: '1px solid var(--accent-dim)' }}>
          <span className="animate-pulse" style={{ color: 'var(--accent)' }}>📞</span>
          <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>Incoming {incomingCall?.type} call…</span>
          <button onClick={answerCall} className="px-3 py-1.5 rounded-lg text-sm font-mono" style={{ background: 'var(--accent)', color: '#fff' }}>Answer</button>
          <button onClick={rejectCall} className="px-3 py-1.5 rounded-lg text-sm font-mono" style={{ background: 'var(--danger-wash)', color: 'var(--danger)' }}>Decline</button>
        </div>
      )}

      {/* Search results overlay */}
      {searchResults !== null && (
        <div className="absolute inset-0 z-10 flex flex-col" style={{ background: 'var(--bg)' }}>
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{searchResults.length} results for "{searchQuery}"</span>
            <button onClick={() => { setSearchResults(null); setSearchOpen(false); setSearchQuery(''); }} className="ml-auto text-sm" style={{ color: 'var(--text-dim)' }}>✕ Close</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {searchResults.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No messages found</p>
            ) : searchResults.map((m) => {
              const sndr = (conversation.members ?? []).find((mb) => mb.user_id === m.senderId);
              return (
                <div key={m.id} className="px-4 py-3 hover-panel-alt" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-xs mb-1 font-mono" style={{ color: 'var(--text-dim)' }}>{sndr?.display_name ?? 'Unknown'} · {new Date(m.createdAt).toLocaleString()}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{decodeMessageText(m.ciphertext)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Pinned / Saved bar (Telegram-style) ── */}
      {(pinnedMessages.length > 0 || bookmarks.length > 0) && (() => {
        // Combined list for cycling: pinned first, then bookmarks
        const allPinned = pinnedMessages;
        const safeIdx = Math.min(pinnedBarIndex, allPinned.length - 1);
        const current = allPinned[safeIdx] ?? null;

        function fmtSecs(s: number) {
          return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        }
        function pinPreview(type: string, ciphertext: string, durationSecs?: number | null): React.ReactNode {
          if (type === 'audio') {
            return (
              <span className="flex items-center gap-1">
                <FaMicrophone size={14} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <span>{durationSecs != null ? fmtSecs(durationSecs) : attachmentNoun('audio')}</span>
              </span>
            );
          }
          if (type === 'image') return <span className="flex items-center gap-1"><FaImage size={13} className="flex-shrink-0" style={{ color: 'var(--accent)' }} /><span>{attachmentNoun(type)}</span></span>;
          if (type === 'video') return <span className="flex items-center gap-1"><FaVideo size={13} className="flex-shrink-0" style={{ color: 'var(--accent)' }} /><span>{attachmentNoun(type)}</span></span>;
          if (type === 'file') return <span className="flex items-center gap-1"><FaPaperclip size={14} className="flex-shrink-0" style={{ color: 'var(--accent)' }} /><span>{attachmentNoun(type)}</span></span>;
          return <span className="truncate">{decodeMessageText(ciphertext)}</span>;
        }

        return (
          <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--panel-alt)' }}>
            {/* ── Collapsed single-line bar ── */}
            <div className="flex items-center gap-0" style={{ height: 40 }}>
              {/* Accent left stripe */}
              <div className="flex-shrink-0 self-stretch w-0.5" style={{ background: 'var(--accent)', margin: '6px 0' }} />

              {/* Preview — click to scroll */}
              <button
                type="button"
                onClick={() => current && scrollToMessage(current.messageId)}
                className="flex-1 flex flex-col justify-center min-w-0 px-3 text-left hover-panel-alt h-full"
              >
                <span className="text-[10.5px] font-semibold font-mono leading-tight" style={{ color: 'var(--accent)' }}>
                  📌 {allPinned.length > 1 ? `Pinned message ${safeIdx + 1}/${allPinned.length}` : 'Pinned message'}
                </span>
                {current && (
                  <span className="text-[12px] leading-tight truncate mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-dim)' }}>{current.senderDisplayName}:</span>
                    {pinPreview(current.type, current.ciphertext)}
                  </span>
                )}
              </button>

              {/* Cycle up/down — only when multiple pins */}
              {allPinned.length > 1 && (
                <div className="flex flex-col flex-shrink-0">
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setPinnedBarIndex((i) => (i - 1 + allPinned.length) % allPinned.length); }}
                    className="h-5 px-1.5 flex items-center hover-panel-alt" title="Previous pin">
                    <svg className="w-3 h-3" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); setPinnedBarIndex((i) => (i + 1) % allPinned.length); }}
                    className="h-5 px-1.5 flex items-center hover-panel-alt" title="Next pin">
                    <FaChevronDown size={14} style={{ color: 'var(--text-dim)' }} />
                  </button>
                </div>
              )}

              {/* Expand toggle */}
              <button type="button"
                onClick={() => setShowPinnedBar((v) => !v)}
                className="flex-shrink-0 h-full px-3 flex items-center hover-panel-alt" title={showPinnedBar ? 'Collapse' : 'Expand'}>
                <FaChevronDown
                  size={14}
                  className={`transition-transform ${showPinnedBar ? 'rotate-180' : ''}`}
                  style={{ color: 'var(--text-dim)' }}
                />
              </button>
            </div>

            {/* ── Expanded tabbed list ── */}
            {showPinnedBar && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {/* Tabs */}
                <div className="flex px-4 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
                  {pinnedMessages.length > 0 && (
                    <button type="button" onClick={() => setPinnedBarTab('pinned')}
                      className="py-2 text-[12px] font-mono border-b-2 transition-colors"
                      style={{ borderColor: pinnedBarTab === 'pinned' ? 'var(--accent)' : 'transparent', color: pinnedBarTab === 'pinned' ? 'var(--accent)' : 'var(--text-dim)' }}>
                      📌 Pinned for all
                    </button>
                  )}
                  {bookmarks.length > 0 && (
                    <button type="button" onClick={() => setPinnedBarTab('saved')}
                      className="py-2 text-[12px] font-mono border-b-2 transition-colors"
                      style={{ borderColor: pinnedBarTab === 'saved' ? 'var(--accent)' : 'transparent', color: pinnedBarTab === 'saved' ? 'var(--accent)' : 'var(--text-dim)' }}>
                      🔖 Saved for me
                    </button>
                  )}
                  <button type="button" onClick={() => setShowPinnedBar(false)} className="ml-auto py-2 flex items-center">
                    <FaXmark size={14} style={{ color: 'var(--text-dim)' }} />
                  </button>
                </div>

                {/* Pinned for all */}
                {pinnedBarTab === 'pinned' && (
                  <div className="py-1 max-h-44 overflow-y-auto">
                    {pinnedMessages.map((p, idx) => (
                      <div key={p.messageId}
                        className="group flex items-center gap-2 px-4 py-2 transition-colors hover-panel-alt cursor-pointer"
                        onClick={() => scrollToMessage(p.messageId)}>
                        {/* Active indicator stripe */}
                        <div className="flex-shrink-0 w-0.5 self-stretch rounded-full" style={{ background: idx === safeIdx ? 'var(--accent)' : 'transparent' }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold font-mono" style={{ color: 'var(--accent)' }}>
                            {p.senderDisplayName}
                            <span className="ml-1 font-normal" style={{ color: 'var(--text-dim)' }}>· {p.pinnedByName !== p.senderDisplayName ? `pinned by ${p.pinnedByName}` : 'pinned'}</span>
                          </p>
                          <p className="text-[12px] truncate mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                            {pinPreview(p.type, p.ciphertext)}
                          </p>
                        </div>
                        {/* Inline unpin — visible on row hover */}
                        <button type="button" title="Unpin"
                          onClick={(e) => { e.stopPropagation(); messagesApi.unpinMessage(p.messageId).then(() => { setPinnedIds((prev) => { const s = new Set(prev); s.delete(p.messageId); return s; }); setPinnedMessages((prev) => prev.filter((x) => x.messageId !== p.messageId)); if (pinnedBarIndex >= pinnedMessages.length - 1) setPinnedBarIndex(0); }).catch(() => {}); }}
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover-panel-alt"
                          style={{ color: 'var(--text-dim)' }}>
                          <FaXmark size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Saved for me */}
                {pinnedBarTab === 'saved' && (
                  <div className="py-1 max-h-44 overflow-y-auto">
                    {bookmarks.map((b) => (
                      <div key={b.messageId}
                        className="group flex items-center gap-2 px-4 py-2 transition-colors hover-panel-alt cursor-pointer"
                        onClick={() => scrollToMessage(b.messageId)}>
                        <div className="w-0.5 self-stretch flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold font-mono" style={{ color: 'var(--accent)' }}>{b.senderDisplayName}</p>
                          <p className="text-[12px] truncate mt-0.5 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                            {pinPreview(b.type, b.ciphertext)}
                          </p>
                        </div>
                        <button type="button" title="Remove bookmark"
                          onClick={(e) => { e.stopPropagation(); messagesApi.unbookmarkMessage(b.messageId).then(() => { setBookmarkIds((prev) => { const s = new Set(prev); s.delete(b.messageId); return s; }); setBookmarks((prev) => prev.filter((x) => x.messageId !== b.messageId)); }).catch(() => {}); }}
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover-panel-alt"
                          style={{ color: 'var(--text-dim)' }}>
                          <FaXmark size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Backdrop to close dropdown */}
      {openMenuId && <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />}

      {/* Forward picker modal */}
      {/* ── Forward picker (Telegram-style) ── */}
      {forwardingMessage && (() => {
        const q = forwardSearch.toLowerCase();
        const filtered = allConversations.filter((c) =>
          getConversationTitle(c, user!.id).toLowerCase().includes(q)
        );
        return (
          <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={(e) => { if (e.target === e.currentTarget) { setForwardingMessage(null); } }}>
            <div className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ background: 'var(--panel)', border: '1px solid var(--border)', maxHeight: '80vh' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: 'var(--text)' }}>Forward message</p>
                  <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>
                    {forwardSelected.size === 0 ? 'Choose who to forward to' : `${forwardSelected.size} selected`}
                  </p>
                </div>
                <button type="button" onClick={() => setForwardingMessage(null)} className="btn-icon" style={{ width: 30, height: 30 }}>
                  <FaXmark size={14} />
                </button>
              </div>

              {/* Search */}
              <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input
                    autoFocus
                    value={forwardSearch}
                    onChange={(e) => setForwardSearch(e.target.value)}
                    placeholder="Find a conversation…"
                    className="w-full pl-8 pr-3 py-2 text-[13px] focus:outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                    onFocus={(e) => (e.target.style.borderColor = 'var(--accent-dim)')}
                    onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
                  />
                </div>
              </div>

              {/* Conversation list */}
              <div className="flex-1 overflow-y-auto py-1">
                {filtered.length === 0 && (
                  <p className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--text-dim)' }}>
                    {allConversations.length === 0 ? 'Loading…' : 'No conversations found'}
                  </p>
                )}
                {filtered.map((c) => {
                  const title = getConversationTitle(c, user!.id);
                  const selected = forwardSelected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setForwardSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover-panel-alt"
                    >
                      {/* Avatar */}
                      <div className="flex-shrink-0 flex items-center justify-center font-mono font-bold text-[13px]"
                        style={{ width: 36, height: 36, borderRadius: 9, background: selected ? 'var(--accent)' : 'var(--panel-alt)', border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`, color: selected ? '#fff' : 'var(--accent)', transition: 'all 0.15s' }}>
                        {selected
                          ? <FaCheck size={14} />
                          : title.slice(0, 1).toUpperCase()}
                      </div>
                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate" style={{ color: selected ? 'var(--text)' : 'var(--text-muted)' }}>{title}</p>
                        <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-dim)' }}>
                          {c.type === 'direct' ? 'Direct message' : c.type === 'group' ? 'Group' : 'Channel'}
                        </p>
                      </div>
                      {/* Checkmark circle */}
                      <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all"
                        style={{ background: selected ? 'var(--accent)' : 'transparent', border: `1.5px solid ${selected ? 'var(--accent)' : 'var(--border)'}` }}>
                        {selected && <FaCheck size={14} className="text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Optional comment */}
              <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
                <input
                  value={forwardComment}
                  onChange={(e) => setForwardComment(e.target.value)}
                  placeholder="Add a comment… (optional)"
                  className="w-full text-[13px] focus:outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--accent-dim)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
                />
              </div>

              {/* Submit */}
              <div className="px-4 pb-4 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleForward}
                  disabled={forwardSelected.size === 0 || forwardLoading}
                  className="w-full font-mono font-semibold text-[13px] disabled:opacity-35 transition-opacity hover:opacity-90"
                  style={{ background: 'var(--accent)', color: '#fff', padding: '11px', borderRadius: 9 }}
                >
                  {forwardLoading
                    ? 'Forwarding…'
                    : forwardSelected.size === 0
                      ? 'Forward'
                      : `Forward (${forwardSelected.size})`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Message list */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-16 flex flex-col" style={{ background: 'var(--bg)' }}>
        {messages.map((message, index) => {
          const mine = message.senderId === user!.id;
          const read = other ? readReceipts[message.id]?.has(other.user_id) : false;
          const text = decodeMessageText(message.ciphertext);
          const sender = membersById.get(message.senderId ?? '');
          const isEditing = editingMessageId === message.id;
          const isMediaBubble = (message.type === 'image' || message.type === 'video') && !message.deletedAt && !isEditing;

          // ── Day divider + consecutive-message grouping ────────────────────
          // startsGroup carries the avatar and the name/time header; endsGroup closes the block.
          const msgDate = new Date(message.createdAt);
          const msgDay = msgDate.toDateString();
          const { startsGroup, endsGroup, startsDay: showDivider } = groupingFor(messages, index);

          let dividerLabel = '';
          if (showDivider) {
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            if (msgDay === today.toDateString()) {
              dividerLabel = 'Today';
            } else if (msgDay === yesterday.toDateString()) {
              dividerLabel = 'Yesterday';
            } else {
              dividerLabel = msgDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            }
          }
          // ─────────────────────────────────────────────────────────────────

          // Bubbles in one block lean toward each other: the outer corner is pointed where the
          // block begins, and flattened where it continues, so a run reads as one shape.
          const R = 16;
          const POINT = 6;
          const outerTop = startsGroup ? POINT : R;
          const outerBottom = endsGroup ? R : POINT;
          const bubbleBorderRadius = mine
            ? `${R}px ${outerTop}px ${outerBottom}px ${R}px`
            : `${outerTop}px ${R}px ${R}px ${outerBottom}px`;

          // Helper: reply quote block
          const ReplyQuote = ({ replyId }: { replyId: string }) => {
            const original = messagesById.get(replyId);
            const authorName = original
              ? (original.senderId === user!.id ? user!.displayName : membersById.get(original.senderId ?? '')?.display_name ?? 'Someone')
              : null;

            function handleJump(e: React.MouseEvent) {
              e.stopPropagation();
              if (msgRefs.current.has(replyId)) {
                scrollToMessage(replyId);
              } else {
                showToast('Original message is not loaded yet');
              }
            }

            return (
              <div
                role="button"
                tabIndex={0}
                onClick={handleJump}
                onKeyDown={(e) => e.key === 'Enter' && handleJump(e as any)}
                className="mb-2 px-2.5 py-1.5 rounded-lg border-l-2 transition-colors"
                style={{
                  cursor: 'pointer',
                  background: mine ? 'rgba(0,0,0,0.12)' : 'var(--panel-alt)',
                  borderColor: mine ? 'rgba(255,255,255,0.4)' : 'var(--accent)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = mine ? 'rgba(0,0,0,0.2)' : 'var(--bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = mine ? 'rgba(0,0,0,0.12)' : 'var(--panel-alt)'; }}
              >
                {original ? (<>
                  <p className="text-[11px] font-semibold mb-0.5" style={{ color: mine ? 'rgba(255,255,255,0.8)' : 'var(--accent)' }}>{authorName}</p>
                  <p className="text-xs truncate" style={{ color: mine ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)' }}>
                    {original.deletedAt ? 'This message was deleted' : original.file ? '📎 Attachment' : decodeMessageText(original.ciphertext)}
                  </p>
                </>) : (
                  <p className="text-xs italic" style={{ color: mine ? 'rgba(255,255,255,0.5)' : 'var(--text-dim)' }}>Original message</p>
                )}
              </div>
            );
          };

          return (
            <div key={message.id}>
              {/* Date divider */}
              {showDivider && (
                <div className="flex items-center justify-center my-4">
                  <span className="px-3 py-1 rounded-full text-[11px] font-mono select-none"
                    style={{ background: 'var(--panel-alt)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                    {dividerLabel}
                  </span>
                </div>
              )}
            <div
              ref={(el) => { if (el) msgRefs.current.set(message.id, el); else msgRefs.current.delete(message.id); }}
              className={`flex items-start gap-2 group ${startsGroup ? 'mt-3' : 'mt-0.5'} ${mine ? 'flex-row-reverse' : 'flex-row'} transition-colors duration-300`}
              style={highlightedMsgId === message.id ? { background: 'var(--accent-wash)', borderRadius: 12, margin: '12px -4px', padding: '0 4px' } : undefined}
              onMouseEnter={(e) => calcToolbarDir(e.currentTarget, message.id)}
            >
              {/* Avatar — on the message that opens the block, so it sits level with the name
                  header. Later messages in the block keep the indent with a spacer. */}
              {!startsGroup ? (
                <div className="flex-shrink-0" style={{ width: 32 }} />
              ) : (() => {
                const avatarUrl = mine ? user!.avatarUrl : sender?.avatar_url;
                const name = mine ? user!.displayName : (sender?.display_name ?? '?');
                return <Avatar name={name} avatarUrl={avatarUrl} size={32} radius={8} fontSize={13} className="flex-shrink-0" title={name} profileUserId={message.senderId} />;
              })()}

              {/* Column: name+time header + bubble + reactions */}
              <div className="flex flex-col max-w-[80%] sm:max-w-[62%]" style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                {/* Forwarded label — shows original sender, preserved through chains */}
                {message.forwardedFromMessageId && message.forwardedFromDisplayName && !message.deletedAt && (
                  <div className="flex items-center gap-1 mb-0.5 px-1" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                    <svg className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[11px] italic" style={{ color: 'var(--text-dim)' }}>
                      Forwarded from <span style={{ color: 'var(--text-muted)', fontStyle: 'normal', fontWeight: 500 }}>{message.forwardedFromDisplayName}</span>
                    </span>
                  </div>
                )}

                {/* Name + timestamp — only on the message that opens the block */}
                {!message.deletedAt && startsGroup && (
                  <div className="flex items-baseline gap-2 mb-1 px-1" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                    <span className="text-[13px] font-semibold" style={{ color: mine ? 'var(--accent)' : 'var(--text)' }}>
                      {mine ? 'You' : sender?.display_name ?? 'Unknown'}
                    </span>
                    <span className="font-mono text-[10.5px]" style={{ color: 'var(--text-dim)' }}>
                      {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {mine && read && ' · ✓✓'}
                    </span>
                    {bookmarkIds.has(message.id) && (
                      <FaBookmark size={12} className="flex-shrink-0" style={{ color: 'var(--warning)' }} />
                    )}
                  </div>
                )}

                {/* Bubble */}
                {isMediaBubble ? (
                  <div className={`relative overflow-hidden max-w-full ${!mine ? 'shadow-sm' : ''}`} style={{ borderRadius: bubbleBorderRadius }}>
                    {message.replyToMessageId && (
                      <div className="px-3 pt-2.5 pb-2" style={{ background: mine ? 'var(--accent)' : 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                        <ReplyQuote replyId={message.replyToMessageId} />
                      </div>
                    )}
                    <MessageAttachment type={message.type} file={message.file!} isMine={mine} compact onOpen={(file, type) => setLightboxItem({ file, type })} />
                    <span className="absolute bottom-2 right-2 text-[10px] text-white bg-black/40 rounded-full px-1.5 py-0.5 select-none">
                      {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {message.editedAt && ' (edited)'}{mine && read && ' ✓✓'}
                    </span>
                  </div>
                ) : (
                  <div className="px-4 py-2.5" title={msgDate.toLocaleString()} style={{ borderRadius: bubbleBorderRadius, background: mine ? 'var(--accent)' : 'var(--panel)', border: mine ? 'none' : '1px solid var(--border)', color: mine ? 'var(--bg-deep)' : 'var(--text-muted)' }}>
                    {message.replyToMessageId && <ReplyQuote replyId={message.replyToMessageId} />}
                    {message.deletedAt ? (
                      <p className="text-sm italic" style={{ color: mine ? 'rgba(8,10,15,0.55)' : 'var(--text-dim)' }}>This message was deleted</p>
                    ) : (<>
                      {message.file && <MessageAttachment type={message.type} file={message.file} isMine={mine} onOpen={(file, type) => setLightboxItem({ file, type })} />}
                      {isEditing ? (
                        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submitEdit(message.id); }}>
                          <input value={editingText} onChange={(e) => setEditingText(e.target.value)} autoFocus className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
                            style={{ background: 'rgba(0,0,0,0.15)', color: mine ? 'var(--bg-deep)' : 'var(--text)', border: '1px solid rgba(0,0,0,0.2)' }} />
                          <div className="flex gap-2">
                            <button type="submit" className="flex-1 py-1 rounded-lg text-xs font-semibold font-mono" style={{ background: mine ? 'var(--bg-deep)' : 'var(--accent)', color: mine ? 'var(--accent)' : 'var(--bg-deep)' }}>Save</button>
                            <button type="button" onClick={cancelEdit} className="flex-1 py-1 rounded-lg text-xs font-mono" style={{ color: mine ? 'rgba(8,10,15,0.6)' : 'var(--text-dim)' }}>Cancel</button>
                          </div>
                        </form>
                      ) : (text && (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          <Linkify text={text} linkStyle={{ color: mine ? 'var(--bg-deep)' : 'var(--accent)' }} />
                        </p>
                      ))}
                    </>)}
                    {/* Link preview */}
                    {!message.deletedAt && message.linkPreview?.title && (
                      <a href={message.linkPreview.url} target="_blank" rel="noopener noreferrer"
                        className="block mt-2 rounded-lg overflow-hidden transition-opacity hover:opacity-90"
                        style={{ border: `1px solid ${mine ? 'rgba(0,0,0,0.2)' : 'var(--border)'}` }}>
                        {message.linkPreview.imageUrl && <img src={message.linkPreview.imageUrl} alt="" className="w-full max-h-32 object-cover" />}
                        <div className="px-3 py-2" style={{ background: mine ? 'rgba(0,0,0,0.12)' : 'var(--panel-alt)' }}>
                          {message.linkPreview.siteName && <p className="text-[10px] uppercase font-semibold mb-0.5 font-mono" style={{ color: mine ? 'rgba(8,10,15,0.7)' : 'var(--text-dim)' }}>{message.linkPreview.siteName}</p>}
                          <p className="text-xs font-semibold leading-tight" style={{ color: mine ? 'var(--bg-deep)' : 'var(--text)' }}>{message.linkPreview.title}</p>
                          {message.linkPreview.description && <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: mine ? 'rgba(8,10,15,0.65)' : 'var(--text-muted)' }}>{message.linkPreview.description}</p>}
                        </div>
                      </a>
                    )}
                    {message.editedAt && !message.deletedAt && (
                      <span className="block text-right text-[10.5px] mt-1 select-none italic font-mono" style={{ color: mine ? 'rgba(8,10,15,0.5)' : 'var(--text-dim)' }}>(edited)</span>
                    )}
                    {/* Read receipt closing the block. The time itself is deliberately absent:
                        the block's header already carries one, and repeating it per bubble was
                        the bulk of the thread's noise. Hovering any bubble still reveals it. */}
                    {!startsGroup && endsGroup && mine && read && !message.deletedAt && (
                      <span className="block mt-0.5 text-[10px] font-mono select-none" style={{ color: 'rgba(8,10,15,0.55)', textAlign: 'right' }}>
                        ✓✓
                      </span>
                    )}
                  </div>
                )}

                {/* Reactions inside column */}
                {!message.deletedAt && (message.reactions ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries((message.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>((acc, r) => {
                      acc[r.emoji] = { count: (acc[r.emoji]?.count ?? 0) + 1, mine: acc[r.emoji]?.mine || r.userId === user!.id };
                      return acc;
                    }, {})).map(([emoji, { count, mine: iMine }]) => (
                      <button key={emoji} onClick={() => toggleReaction(message.id, emoji)}
                        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] border transition-all"
                        style={iMine
                          ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                          : { background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                        {emoji} <span className={iMine ? 'font-bold' : 'font-medium'}>{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>{/* end column */}

              {/* Hover toolbar — sibling to the column */}
              {!isEditing && !message.deletedAt && (
                <div className={`flex-shrink-0 transition-all duration-150 ${(msgDirs[message.id] ?? 'up') === 'up' ? 'self-end mb-0.5' : 'self-start mt-0.5'} ${openMenuId === message.id ? 'opacity-100 pointer-events-auto' : openMenuId !== null ? 'opacity-0 pointer-events-none' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 pointer-events-auto sm:pointer-events-none sm:group-hover:pointer-events-auto'}`}>
                  <div className="flex items-center rounded-2xl overflow-visible" style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    {QUICK_EMOJIS.map((e) => (
                      <button key={e} onClick={() => toggleReaction(message.id, e)} className="hidden sm:flex w-8 h-8 text-[16px] items-center justify-center transition-colors first:rounded-l-2xl hover-panel-alt">{e}</button>
                    ))}
                    <div className="hidden sm:block w-px h-5 mx-0.5 flex-shrink-0" style={{ background: 'var(--border)' }} />
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); calcToolbarDir(e.currentTarget, message.id); setOpenMenuId(openMenuId === message.id ? null : message.id); }}
                        className="w-8 h-8 flex items-center justify-center transition-colors rounded-r-2xl hover-panel-alt" style={{ color: 'var(--text-dim)' }}>
                        <FaChevronDown size={14} />
                      </button>
                      {openMenuId === message.id && (
                        <div className={`absolute z-30 w-52 rounded-xl overflow-hidden py-1 ${mine ? 'right-0' : 'left-0'} ${(msgDirs[message.id] ?? 'up') === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
                          style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}>

                          {/* 1. Reply */}
                          <button type="button" onClick={() => { setReplyingTo(message); setOpenMenuId(null); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                            <FaReply size={14} style={{ color: 'var(--text-dim)' }} />
                            Reply
                          </button>

                          {/* 2. Copy text — text messages only */}
                          {message.type === 'text' && !message.deletedAt && decodeMessageText(message.ciphertext) && (
                            <button type="button" onClick={() => { navigator.clipboard.writeText(decodeMessageText(message.ciphertext)); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                              <FaRegCopy size={14} style={{ color: 'var(--text-dim)' }} />
                              Copy text
                            </button>
                          )}

                          {/* 3a. Save for me (personal bookmark) */}
                          {!message.deletedAt && (
                            <button type="button" onClick={() => { handleBookmark(message); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                              {bookmarkIds.has(message.id)
                                ? <FaBookmark size={14} style={{ color: 'var(--warning)' }} />
                                : <FaRegBookmark size={14} style={{ color: 'var(--text-dim)' }} />}
                              {bookmarkIds.has(message.id) ? 'Remove bookmark' : 'Save for me'}
                            </button>
                          )}

                          {/* 3b. Pin for all */}
                          {!message.deletedAt && (
                            <button type="button" onClick={() => { handlePin(message); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                              <FaThumbtack size={14} style={{ color: pinnedIds.has(message.id) ? 'var(--accent)' : 'var(--text-dim)' }} />
                              {pinnedIds.has(message.id) ? 'Unpin for all' : 'Pin for all'}
                            </button>
                          )}

                          {/* 4. Forward */}
                          {!message.deletedAt && (
                            <button type="button" onClick={() => { openForwardPicker(message); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                              <FaShare size={14} style={{ color: 'var(--text-dim)' }} />
                              Forward
                            </button>
                          )}

                          {/* 5. Edit — own messages */}
                          {mine && !message.deletedAt && message.type === 'text' && (
                            <>
                              <div className="h-px mx-3 my-1" style={{ background: 'var(--border)' }} />
                              <button type="button" onClick={() => { startEdit(message); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                                <FaPen size={13} style={{ color: 'var(--text-dim)' }} />
                                Edit message
                              </button>
                            </>
                          )}

                          {/* 6. Delete — admin only */}
                          {user?.role === 'admin' && !message.deletedAt && (
                            <>
                              <div className="h-px mx-3 my-1" style={{ background: 'var(--border)' }} />
                              <button type="button" onClick={() => { handleDelete(message.id); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors" style={{ color: 'var(--danger)' }}
                                onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--danger-wash)')}
                                onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}>
                                <FaTrash size={13} />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>
          );
        })}
        {/* Spacer so the last message is never hidden behind the input bar or hover toolbar */}
        <div ref={bottomRef} style={{ paddingBottom: 8 }} />
      </div>

      {/* Reply preview bar */}
      {replyingTo && (
        <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0" style={{ background: 'var(--accent-wash)', borderTop: '1px solid var(--accent-dim)' }}>
          <div className="w-0.5 h-8 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold leading-tight font-mono" style={{ color: 'var(--accent)' }}>
              {replyingTo.senderId === user!.id ? user!.displayName : membersById.get(replyingTo.senderId ?? '')?.display_name ?? 'Someone'}
            </p>
            <p className="text-xs truncate leading-tight mt-0.5" style={{ color: 'var(--text-dim)' }}>
              {replyingTo.deletedAt ? 'This message was deleted' : replyingTo.file ? '📎 Attachment' : decodeMessageText(replyingTo.ciphertext)}
            </p>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="p-1.5 rounded-lg transition-colors flex-shrink-0 hover-panel-alt" style={{ color: 'var(--text-dim)' }} aria-label="Cancel reply">
            <FaXmark size={14} />
          </button>
        </div>
      )}

      {/* Input bar */}
      <form className="flex items-center gap-2 px-4 pt-3 flex-shrink-0" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }} onSubmit={handleSend}>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || isRecording} title="Attach file" className="disabled:opacity-40 disabled:cursor-not-allowed btn-icon">
          <FaPaperclip size={14} />
        </button>
        <button type="button" onClick={isRecording ? stopRecording : startRecording} disabled={uploading} title={isRecording ? 'Stop recording' : 'Record voice note'}
          className={`disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 ${isRecording ? 'rounded-lg' : 'btn-icon'}`}
          style={isRecording ? { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', background: 'var(--danger-wash)', border: '1px solid var(--danger-border)' } : undefined}>
          <FaMicrophone size={14} />
        </button>
        <input value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setReplyingTo(null); }}
          placeholder={isRecording ? 'Recording...' : uploading ? 'Uploading...' : replyingTo ? 'Reply...' : 'Message...'}
          autoComplete="off" disabled={isRecording || uploading}
          className="input-base flex-1 disabled:opacity-60 transition-all" />
        <button type="submit" disabled={!input.trim() || uploading || isRecording} title="Send" className="btn-primary disabled:opacity-40">
          <FaPaperPlane size={14} />
        </button>
      </form>

      {/* ── Toast notification — inside the thread column so it stays centred over the
           conversation when the info panel takes its share of the width ── */}
      {toast && (
        <div className="absolute bottom-24 left-1/2 z-50 pointer-events-none"
          style={{ transform: 'translateX(-50%)', animation: 'fadeInUp 0.2s ease' }}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-2xl font-mono text-[13px]"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)', whiteSpace: 'nowrap' }}>
            <FaCheck size={14} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
            {toast}
          </div>
        </div>
      )}
      </div>

      {/* Info panel. From lg it is a real column and the thread reflows beside it; below that
          there is not enough width to split, so it stays an overlay with a dismissable scrim. */}
      {showInfoPanel && (
        <>
          <div className="lg:hidden absolute inset-0 z-20 bg-black/20" onClick={() => setShowInfoPanel(false)} />
          <aside
            className="absolute inset-y-0 right-0 w-full z-30 shadow-2xl
                       lg:relative lg:inset-auto lg:w-80 lg:flex-shrink-0 lg:z-auto lg:shadow-none"
            style={{ background: 'var(--bg)' }}
          >
            <ConversationInfoPanel conversation={conversation} currentUserId={user!.id} presence={presence} onClose={() => setShowInfoPanel(false)} onOpenLightbox={(file, type) => setLightboxItem({ file, type })} initialTab="media" />
          </aside>
        </>
      )}

      {lightboxItem && <Lightbox file={lightboxItem.file} type={lightboxItem.type} onClose={() => setLightboxItem(null)} />}

      {confirmDialog}

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}
