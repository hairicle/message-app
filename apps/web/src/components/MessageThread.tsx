'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
import { Lightbox, type LightboxItem } from './Lightbox';
import { MessageAttachment } from './MessageAttachment';
import { Linkify } from './Linkify';
import { MessageText } from './MessageText';
import { useConfirm } from './ConfirmDialog';
import { Avatar } from './ui';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { decodeMessageText, encodeMessageText } from '../utils/text';
import { FaArrowRotateRight, FaBookmark, FaCheck, FaEllipsisVertical, FaRegFaceSmile, FaChevronDown, FaChevronLeft, FaImage, FaMagnifyingGlass, FaMicrophone, FaPaperPlane, FaPaperclip, FaPen, FaPhone, FaRegBookmark, FaRegCopy, FaReply, FaShare, FaThumbtack, FaTrash, FaVideo, FaXmark } from 'react-icons/fa6';
import { attachmentNoun } from '../utils/messagePreview';
import { attachmentTooLargeMessage } from '../utils/uploadLimits';
import { groupingFor } from '../utils/messageGrouping';
import { groupReactions } from '../utils/reactionSummary';
import { compressImage } from '../utils/imageCompression';
import { ReplyPreview } from './ReplyPreview';
import { MessageAlbum } from './MessageAlbum';
import { buildAlbums } from '../utils/messageAlbums';

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
  /** A group picture changed here; the conversation list holds its own copy of the row. */
  onConversationAvatarChanged?: (conversationId: string, avatarUrl: string | null) => void;
  /** A rename or membership change, so the list row can follow. */
  onConversationChanged?: (conversation: Conversation) => void;
  /** The user left this conversation; it should stop being shown at all. */
  onConversationLeft?: (conversationId: string) => void;
}

/** Matches the API's default page size, which is what tells us whether more history exists. */
const MESSAGE_PAGE_SIZE = 50;

/**
 * How far back a jump will page looking for its target before giving up.
 *
 * Bounded so a link to something from last year cannot walk the entire conversation into memory
 * one request at a time; ten pages is deep enough for anything reachable from search or the
 * shared-media tabs in practice.
 */
const MAX_JUMP_PAGES = 10;

/** Roughly six lines. Past this the composer scrolls rather than eating the conversation. */
const COMPOSER_MAX_HEIGHT = 132;

/** A message written but not yet accepted by the server. */
interface OutboxItem {
  id: string;
  text: string;
  replyToMessageId?: string;
  state: 'sending' | 'failed';
  error?: string;
}

/**
 * An attachment the user has chosen but not yet sent.
 *
 * Picking a file stages it; nothing leaves the browser until Send is pressed. Dropping a file
 * straight into the conversation used to post it immediately, which left no chance to see what
 * had been picked, add a note to it, or change your mind.
 */
interface StagedFile {
  id: string;
  file: File;
  /** Object URL for images and video, so the strip shows the picture rather than a filename. */
  previewUrl?: string;
  /**
   * How it should be sent. "media" renders as a photo or a clip and is resized on the way out;
   * "file" keeps the original bytes and arrives as a download.
   */
  mode: 'media' | 'file';
  /** 0–1 while uploading. */
  progress: number;
  status: 'staged' | 'uploading' | 'failed';
  error?: string;
}

export function addMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((m) => m.id === message.id)) return messages;
  const newTime = new Date(message.createdAt).getTime();
  const insertAt = messages.findIndex((m) => new Date(m.createdAt).getTime() > newTime);
  if (insertAt === -1) return [...messages, message];
  return [...messages.slice(0, insertAt), message, ...messages.slice(insertAt)];
}

export function MessageThread({ conversationId, presence, onBack, onConversationAvatarChanged, onConversationChanged, onConversationLeft }: MessageThreadProps) {
  const { user } = useAuth();
  const socket = useSocket();
  const { confirm, confirmDialog } = useConfirm();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  /**
   * How far each member has read, as an ISO timestamp.
   *
   * A cutoff per person rather than a set of ids per message: that is how the server stores it,
   * and it is the only shape that can answer "has this person seen that message?" for messages
   * that were already read before this session began.
   */
  const [readCutoffs, setReadCutoffs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Which message owns the reaction popover, and which way it opens. Exactly one at a time —
  // the toolbar used to be rendered for every message and merely hidden with opacity, so a long
  // thread carried hundreds of invisible toolbars and their emoji buttons in the DOM. Holding
  // the direction here rather than per message keeps it impossible for a stale entry to decide
  // where a later popover opens.
  const [activePicker, setActivePicker] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);
  const longPressRef = useRef<number | null>(null);
  const hoverOpenRef = useRef<number | null>(null);
  const hoverCloseRef = useRef<number | null>(null);
  // The quick reactions are opened deliberately, from the smiley — they are no longer the
  // resting state of a hovered message.
  const [emojiBarFor, setEmojiBarFor] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<Set<string>>(new Set());
  const [showPinnedBar, setShowPinnedBar] = useState(false);
  const [pinnedBarTab, setPinnedBarTab] = useState<'pinned' | 'saved'>('pinned');
  const [pinnedBarIndex, setPinnedBarIndex] = useState(0);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // A list rather than one message: the shared-media tabs can forward a selection, and the
  // single-message menu is just the one-element case of the same picker.
  const [forwardingIds, setForwardingIds] = useState<string[]>([]);
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
  // Older history is fetched a page at a time as the reader scrolls up. Only the newest page used
  // to load, so anything past it was unreachable — and a jump to an older message, from a reply
  // quote or the shared-media tabs, could never land.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  /** Distance from the bottom, kept across a prepend so the view does not jump. */
  const anchorFromBottomRef = useRef<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** Which reaction pill is showing who reacted. One at a time, like the message picker. */
  const [reactionTip, setReactionTip] = useState<{ messageId: string; emoji: string } | null>(null);
  const reactionTipRef = useRef<number | null>(null);
  /** The "@…" being typed right now, if any, and where it starts in the input. */
  const [mentionQuery, setMentionQuery] = useState<{ at: number; term: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /**
   * Messages written but not yet accepted by the server.
   *
   * Kept beside the thread rather than inside it: the message list drives grouping, pagination
   * and jump-to-message, all of which key off server ids that these do not have yet.
   */
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const flushingRef = useRef(false);

  /** Picking several messages at once, to forward or delete them together. */
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /**
   * Whether the first page has come back yet.
   *
   * An empty list means two different things — nothing has been said, or nothing has arrived yet
   * — and telling someone to start a conversation that already has a hundred messages in it,
   * because the request is still in flight, would be worse than the blank it replaces.
   */
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [jumping, setJumping] = useState(false);
  const jumpingRef = useRef(false);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Nested enter/leave events fire per child; counting them avoids flicker over the thread. */
  const dragDepthRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    markedReadRef.current = new Set();
    setSelectMode(false);
    setSelectedIds(new Set());
    // Anything staged belonged to the conversation being left. Carrying it over would send those
    // files into whichever conversation was opened next.
    setStaged((prev) => {
      for (const f of prev) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return [];
    });
    setMessages([]);
    setConversation(null);
    setReadCutoffs({});
    setTypingUsers(new Set());

    conversationsApi.getConversation(conversationId).then(({ conversation }) => {
      if (cancelled) return;
      setConversation(conversation);
      // Seeded from the server, or nothing read before this session would ever show as read.
      const seeded: Record<string, string> = {};
      for (const m of conversation.members ?? []) {
        if (m.last_read_at) seeded[m.user_id] = new Date(m.last_read_at).toISOString();
      }
      setReadCutoffs(seeded);
    }).catch(() => {});

    setHasOlder(false);
    setMessagesLoaded(false);
    messagesApi.listMessages(conversationId).then(({ messages }) => {
      // Backend already returns oldest → newest (ORDER BY created_at DESC, then reversed server-side)
      if (cancelled) return;
      setMessages(messages);
      setMessagesLoaded(true);
      // A short page means this is the whole conversation; a full one means there may be more.
      setHasOlder(messages.length >= MESSAGE_PAGE_SIZE);
    }).catch(() => { if (!cancelled) setMessagesLoaded(true); });

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
    const handleMessageRead = (payload: { messageId: string; userId: string; readAt?: string }) => {
      // Falls back to the message's own time when the event predates readAt being sent.
      const at = payload.readAt ?? messages.find((m) => m.id === payload.messageId)?.createdAt;
      if (!at) return;
      setReadCutoffs((prev) => {
        const current = prev[payload.userId];
        // Only ever forward, matching the server: an out-of-order receipt must not un-read.
        if (current && new Date(current) >= new Date(at)) return prev;
        return { ...prev, [payload.userId]: new Date(at).toISOString() };
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

  // Restoring the offset has to happen before the browser paints, or the thread visibly jumps.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || anchorFromBottomRef.current === null) return;
    el.scrollTop = el.scrollHeight - anchorFromBottomRef.current;
    anchorFromBottomRef.current = null;
  }, [messages]);

  useEffect(() => {
    // A prepend changes `messages` too. Scrolling to the bottom then would throw the reader back
    // to the newest message the moment they reached for older ones.
    if (anchorFromBottomRef.current !== null) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!socket || !user) return;
    // Read state on the server is a single cutoff per member, so marking the newest message from
    // someone else covers everything before it. This used to emit once per unread message, which
    // meant opening a busy conversation fired a burst of events that all recorded the same fact.
    let newest: Message | null = null;
    for (const message of messages) {
      if (message.senderId && message.senderId !== user.id) newest = message;
    }
    if (!newest || markedReadRef.current.has(newest.id)) return;

    markedReadRef.current.add(newest.id);
    socket.emit('message:read', { messageId: newest.id });
  }, [socket, user, messages]);

  /**
   * Fetch the page before the oldest message currently held.
   *
   * Guarded by a ref rather than the state flag: scroll events arrive far faster than React
   * re-renders, so reading `loadingOlder` here would let several identical requests through
   * before the first had set it.
   */
  async function loadOlderMessages() {
    const el = scrollContainerRef.current;
    if (!el || loadingOlderRef.current || !hasOlder || messages.length === 0) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    // Measured from the bottom, since the top is exactly what the prepend moves.
    anchorFromBottomRef.current = el.scrollHeight - el.scrollTop;

    try {
      const { messages: older } = await messagesApi.listMessages(conversationId, messages[0].id);
      if (older.length < MESSAGE_PAGE_SIZE) setHasOlder(false);
      if (older.length === 0) {
        anchorFromBottomRef.current = null;
        return;
      }
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !known.has(m.id));
        if (fresh.length === 0) {
          anchorFromBottomRef.current = null;
          return prev;
        }
        return [...fresh, ...prev];
      });
    } catch {
      anchorFromBottomRef.current = null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  /**
   * Height follows the content. Collapsed to `auto` first so the measurement is of the text
   * itself rather than of whatever the box already happened to be — without that it can only
   * ever grow, never shrink back as lines are deleted.
   */
  function resizeComposer() {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }

  useLayoutEffect(resizeComposer, [input]);

  /**
   * Screenshots and copied images arrive on the clipboard as files. Without this the only way to
   * send one was to save it to disk first and pick it from the file dialog.
   */
  function handleComposerPaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    // Only when there is no text alongside — pasting a copied cell from a spreadsheet carries
    // both, and the text is what was meant.
    if (e.clipboardData.getData('text/plain').trim()) return;
    e.preventDefault();
    stageFiles(files);
  }

  /**
   * Open the viewer on one file, with the rest of the conversation's media behind it so the
   * arrows have somewhere to go.
   *
   * A file opened from the shared-media tabs can be older than the loaded thread, in which case
   * there is nothing to page through and it opens on its own.
   */
  function openLightbox(file: FileMeta, type: MessageType) {
    const items: LightboxItem[] = messages
      .filter((m) => (m.type === 'image' || m.type === 'video') && m.file && !m.deletedAt)
      .map((m) => ({ file: m.file!, type: m.type as MessageType }));
    const index = items.findIndex((i) => i.file.id === file.id);
    setLightbox(index === -1 ? { items: [{ file, type }], index: 0 } : { items, index });
  }

  /**
   * Recognise an "@…" the caret is currently inside, so the picker can offer names for it.
   *
   * Anchored to the word the caret is in rather than the last "@" in the box: with two mentions
   * in a message, editing the first must not offer completions for the second.
   */
  function detectMention(value: string, caret: number) {
    const upToCaret = value.slice(0, caret);
    const at = upToCaret.lastIndexOf('@');
    if (at === -1) return setMentionQuery(null);

    // Must begin a word, or an email address would open the picker mid-address.
    const before = at === 0 ? '' : upToCaret[at - 1];
    if (before && /[\w@]/.test(before)) return setMentionQuery(null);

    const term = upToCaret.slice(at + 1);
    // A space ends it: "@" alone offers everyone, but "@dara said" is no longer a mention query.
    if (/\s/.test(term)) return setMentionQuery(null);

    setMentionQuery({ at, term });
    setMentionIndex(0);
  }

  /** Replace the "@…" being typed with a full username. */
  function applyMention(username: string) {
    if (!mentionQuery) return;
    const el = composerRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = `${input.slice(0, mentionQuery.at)}@${username} ${input.slice(caret)}`;
    setInput(next);
    setMentionQuery(null);
    // Put the caret after the inserted name, or typing continues from wherever it happened to be.
    requestAnimationFrame(() => {
      const pos = mentionQuery.at + username.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  /**
   * Send everything waiting, oldest first.
   *
   * Serial, and guarded so two triggers cannot run it at once — reconnecting while a retry is
   * already in flight would otherwise send the same message twice.
   */
  async function flushOutbox() {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      // Read from a ref-free snapshot each pass so items queued during the flush are picked up.
      for (;;) {
        const next = await new Promise<OutboxItem | undefined>((resolve) => {
          setOutbox((prev) => {
            resolve(prev.find((o) => o.state !== 'sending') ?? prev.find((o) => o.state === 'failed'));
            return prev;
          });
        });
        if (!next) break;

        setOutbox((prev) => prev.map((o) => (o.id === next.id ? { ...o, state: 'sending', error: undefined } : o)));
        try {
          await dispatchMessage({
            conversationId,
            ciphertext: encodeMessageText(next.text),
            replyToMessageId: next.replyToMessageId,
          });
          setOutbox((prev) => prev.filter((o) => o.id !== next.id));
        } catch (err) {
          setOutbox((prev) => prev.map((o) => (o.id === next.id
            ? { ...o, state: 'failed', error: (err as Error).message || 'Could not send' }
            : o)));
          // Stop at the first failure: pressing on would deliver later messages before earlier
          // ones, which is worse than waiting.
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }

  function toggleSelected(messageId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }

  function beginSelecting(messageId: string) {
    setSelectMode(true);
    setSelectedIds(new Set([messageId]));
    setOpenMenuId(null);
    setActivePicker(null);
  }

  function exitSelecting() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function handleInputChange(value: string) {
    setInput(value);
    detectMention(value, composerRef.current?.selectionStart ?? value.length);
    if (!socket) return;
    socket.emit('typing:start', { conversationId });
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => { socket.emit('typing:stop', { conversationId }); }, 2000);
  }

  /**
   * Send a message, resolving only once the server has it.
   *
   * The socket path is used only while it is actually connected. socket.io buffers an emit made
   * on a disconnected socket and delivers it whenever it reconnects, with the acknowledgement
   * arriving much later or never — so a send with no network used to resolve instantly and be
   * lost without a trace. Falling back to HTTP means an offline send fails, which is the honest
   * answer and the one the outbox can act on.
   */
  function dispatchMessage(payload: { conversationId: string; type?: MessageType; ciphertext?: string; fileId?: string; replyToMessageId?: string }): Promise<Message> {
    if (socket?.connected) {
      return new Promise<Message>((resolve, reject) => {
        // Acknowledged or given up on: without a timeout a send into a half-open connection
        // waits for ever and the message sits as "sending" until the page is reloaded.
        socket.timeout(12_000).emit(
          'message:send',
          payload,
          (timedOut: Error | null, res?: { ok: boolean; message?: Message; error?: string }) => {
            if (timedOut) return reject(new Error('No answer from the server'));
            if (!res?.ok || !res.message) return reject(new Error(res?.error ?? 'The server refused it'));
            setMessages((prev) => addMessage(prev, res.message!));
            resolve(res.message);
          },
        );
      });
    }

    return messagesApi.sendMessage(payload).then(({ message }) => {
      setMessages((prev) => addMessage(prev, message));
      return message;
    });
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

  /**
   * Delete one or more messages after a single confirmation.
   *
   * Reached from the shared-media tabs, where a selection can span several items — asking once
   * per message would turn "delete 12 photos" into twelve dialogs.
   */
  async function deleteMessages(ids: string[]) {
    if (ids.length === 0) return;
    const ok = await confirm({
      title: ids.length > 1 ? `Delete ${ids.length} messages?` : 'Delete this message?',
      description: <>{ids.length > 1 ? 'They' : 'The message'} will be removed for everyone in this conversation. <b style={{ color: 'var(--text-muted)' }}>This cannot be undone.</b></>,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (!ok) return;

    for (const id of ids) {
      if (socket) {
        socket.emit('message:delete', { messageId: id });
      } else {
        await messagesApi.deleteMessage(id);
        setMessages((prev) => prev.map((m) => m.id === id ? { ...m, ciphertext: '', file: undefined, deletedAt: new Date().toISOString() } : m));
      }
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

  /**
   * Enter sends; Shift+Enter (or Ctrl/Cmd+Enter) starts a new line.
   *
   * The composer used to be a single-line input, so a message could not contain a line break at
   * all — the bubble has always rendered them with whitespace-pre-wrap, there was simply no way
   * to type one.
   *
   * IME composition is excluded: while composing Khmer, Chinese or Japanese, Enter accepts the
   * candidate word and must not also post the message.
   */
  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // The mention picker takes these first. Without that, Enter would send the message instead of
    // choosing the highlighted name, which is the one keystroke everybody uses.
    if (mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(mentionCandidates[mentionIndex].username);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }

    if (e.key === 'Escape') { setReplyingTo(null); return; }
    if (e.key !== 'Enter') return;
    if (e.nativeEvent.isComposing) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

    e.preventDefault();
    void handleSend(e);
  }

  /**
   * Send whatever is composed: the staged attachments, then the typed text.
   *
   * Attachments go first so the text reads as a note about them, which is the order both
   * Messenger and Telegram end up showing. They upload one at a time rather than together, so
   * they arrive in the order they were picked instead of by whichever finished first.
   *
   * The reply is spent on the first thing actually sent — a reply points at one message, and
   * repeating it would quote the same thing several times over.
   */
  async function handleSend(e: FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    const text = input.trim();
    const toSend = staged.filter((f) => f.status !== 'uploading');
    if ((!text && toSend.length === 0) || sending) return;

    setInput('');
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    socket?.emit('typing:stop', { conversationId });

    const replyToId = replyingTo?.id;
    setReplyingTo(null);
    setSending(true);
    try {
      let replySpent = false;
      for (const item of toSend) {
        const ok = await sendStaged(item, replySpent ? undefined : replyToId);
        if (ok) replySpent = true;
      }
      // Still sent even if an attachment failed — the words were written and holding them back
      // because a file did not upload would lose them.
      if (text) {
        // Through the outbox rather than straight out: a send with no network has to survive
        // failing, and the queue is the only thing that remembers it.
        setOutbox((prev) => [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text,
          replyToMessageId: replySpent ? undefined : replyToId,
          state: 'sending',
        }]);
        await flushOutbox();
      }
    } finally {
      setSending(false);
    }
  }

  /** Stage files without sending them. Nothing is uploaded until Send is pressed. */
  function stageFiles(files: File[]) {
    if (files.length === 0) return;

    // Checked before staging, not after uploading. The API refuses anything over the limit, but it
    // can only do so once the bytes have arrived — so without this the person watches a progress
    // bar cross a 200 MB file and is told at the end. The server remains what enforces it.
    const tooLarge = files.map((f) => attachmentTooLargeMessage(f)).filter((m): m is string => m !== null);
    if (tooLarge.length > 0) {
      window.alert(tooLarge.join('\n\n'));
      files = files.filter((f) => attachmentTooLargeMessage(f) === null);
      if (files.length === 0) return;
    }

    setStaged((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/')
          ? URL.createObjectURL(file)
          : undefined,
        // Media defaults to being shown; everything else can only be a file anyway.
        mode: (file.type.startsWith('image/') || file.type.startsWith('video/')) ? 'media' as const : 'file' as const,
        progress: 0,
        status: 'staged' as const,
      })),
    ]);
  }

  /** Drop a staged file, releasing the preview so the object URL is not leaked. */
  function unstage(id: string) {
    setStaged((prev) => {
      const going = prev.find((f) => f.id === id);
      if (going?.previewUrl) URL.revokeObjectURL(going.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  /**
   * Upload one staged file and post it as a message.
   *
   * Returns whether it succeeded, so the caller can decide what to do with the rest of the batch
   * and whether the reply has been spent.
   */
  async function sendStaged(item: StagedFile, replyToId: string | undefined): Promise<boolean> {
    setStaged((prev) => prev.map((f) => (f.id === item.id ? { ...f, status: 'uploading', progress: 0, error: undefined } : f)));
    try {
      // Only resized when it is going to be shown. Sending as a file means the original, which is
      // the entire reason for offering the choice.
      const payload = item.mode === 'media' ? await compressImage(item.file) : item.file;
      const { file: meta } = await filesApi.uploadFile(payload, payload.name, {
        onProgress: (fraction) =>
          setStaged((prev) => prev.map((f) => (f.id === item.id ? { ...f, progress: fraction } : f))),
      });
      await dispatchMessage({
        conversationId,
        // Sent as a file, it is a file — that is what makes it arrive as a download with its name
        // and size rather than as a picture.
        type: item.mode === 'file' ? 'file' : attachmentTypeForMime(item.file.type),
        fileId: meta.id,
        replyToMessageId: replyToId,
      });
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      setStaged((prev) => prev.filter((f) => f.id !== item.id));
      return true;
    } catch (err) {
      // Left staged with its error rather than discarded: the file is still here, and losing it
      // would mean picking it again from scratch.
      setStaged((prev) => prev.map((f) => (f.id === item.id
        ? { ...f, status: 'failed', error: (err as Error).message || 'Upload failed' }
        : f)));
      return false;
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Cleared so choosing the same file again still fires a change event.
    e.target.value = '';
    stageFiles(picked);
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

  function openForwardPicker(messageIds: string[]) {
    if (messageIds.length === 0) return;
    setForwardingIds(messageIds);
    setForwardSearch('');
    setForwardSelected(new Set());
    setForwardComment('');
    // Load conversations fresh when picker opens
    conversationsApi.listConversations().then(({ conversations }) => {
      setAllConversations(conversations.filter((c) => c.id !== conversationId));
    }).catch(() => {});
  }

  async function handleForward() {
    if (forwardingIds.length === 0 || forwardSelected.size === 0) return;
    setForwardLoading(true);
    const targets = allConversations.filter((c) => forwardSelected.has(c.id));
    try {
      // Targets run in parallel, but the messages within one target go in sequence: forwarding a
      // selection should arrive in the order it was picked, and racing them would shuffle it.
      await Promise.all(targets.map(async (c) => {
        for (const id of forwardingIds) {
          await messagesApi.forwardMessage(id, c.id);
        }
        if (forwardComment.trim()) {
          await messagesApi.sendMessage({ conversationId: c.id, ciphertext: encodeMessageText(forwardComment.trim()) });
        }
      }));
      const names = targets.map((c) => getConversationTitle(c, user!.id)).join(', ');
      showToast(forwardingIds.length > 1 ? `Forwarded ${forwardingIds.length} items to ${names}` : `Forwarded to ${names}`);
      setForwardingIds([]);
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

  /**
   * Jump to a message from the info panel's Media/Files/Voice tabs.
   *
   * Those tabs list every attachment in the conversation, including ones far above the loaded
   * window — so unlike a reply quote, a miss here is expected rather than exceptional, and has to
   * say so instead of silently doing nothing.
   */
  /**
   * Scroll to a message, loading older history until it is there to scroll to.
   *
   * Search and the shared-media tabs both list things from the whole conversation while the
   * thread holds only the pages read so far, so a target is routinely absent. Telling the reader
   * to scroll up themselves was an instruction to do by hand what this can do.
   */
  async function jumpToMessage(messageId: string) {
    if (msgRefs.current.has(messageId)) {
      scrollToMessage(messageId);
      return;
    }

    const el = scrollContainerRef.current;
    if (!el || jumpingRef.current) return;
    jumpingRef.current = true;
    setJumping(true);

    try {
      let collected: Message[] = [];
      let cursor = messages[0]?.id;
      let reachedStart = false;

      for (let page = 0; page < MAX_JUMP_PAGES; page++) {
        const { messages: older } = await messagesApi.listMessages(conversationId, cursor);
        if (older.length === 0) { reachedStart = true; break; }
        collected = [...older, ...collected];
        cursor = older[0].id;
        if (older.some((m) => m.id === messageId)) break;
        if (older.length < MESSAGE_PAGE_SIZE) { reachedStart = true; break; }
      }

      if (collected.length > 0) {
        // Anchored like an ordinary prepend, so the thread does not lurch to the bottom before
        // the scroll below moves it deliberately.
        anchorFromBottomRef.current = el.scrollHeight - el.scrollTop;
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = collected.filter((m) => !known.has(m.id));
          return fresh.length ? [...fresh, ...prev] : prev;
        });
        if (reachedStart) setHasOlder(false);
      }

      // Two frames: one for React to commit the new messages, one for the browser to lay them
      // out, so the target has a position to scroll to.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      if (msgRefs.current.has(messageId)) {
        scrollToMessage(messageId);
      } else {
        showToast(reachedStart
          ? 'That message is no longer in this conversation'
          : 'That message is too far back to jump to');
      }
    } catch {
      showToast('Could not load that part of the conversation');
    } finally {
      jumpingRef.current = false;
      setJumping(false);
    }
  }

  /**
   * Open the reaction popover against a bubble, choosing its side.
   *
   * Upward by default, so it does not cover the reply below it — but near the top of the thread
   * there is nothing above to open into, and it would be clipped by the header.
   */
  function openPicker(el: Element, id: string) {
    const rect = el.getBoundingClientRect();
    const containerTop = scrollContainerRef.current?.getBoundingClientRect().top ?? 0;
    const dir: 'up' | 'down' = rect.top - containerTop < 48 ? 'down' : 'up';
    setActivePicker({ id, dir });
  }

  /**
   * Hover opens on a delay. Without one, dragging the pointer across the thread to reach the
   * scrollbar or the composer flashes a popover over every message it crosses.
   */
  function schedulePicker(el: Element, id: string) {
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    hoverOpenRef.current = window.setTimeout(() => openPicker(el, id), 140);
  }

  function cancelScheduledPicker() {
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    hoverOpenRef.current = null;
  }

  /**
   * Closing is delayed too, and any re-entry cancels it.
   *
   * The controls sit outside the bubble's own box, so travelling to them crosses a boundary. A
   * close that fires on the way unmounts the button under the pointer just before it is
   * clicked — the controls appear, and cannot be used.
   */
  function closePickerSoon(id: string) {
    if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = window.setTimeout(() => {
      setActivePicker((p) => (p?.id === id ? null : p));
    }, 220);
  }

  function keepPickerOpen() {
    if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = null;
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
  const memberUsernames = (conversation.members ?? []).map((m) => m.username).filter(Boolean);
  // Everyone but you: mentioning yourself notifies nobody and is never what was meant.
  const mentionCandidates = mentionQuery
    ? (conversation.members ?? [])
        .filter((m) => m.user_id !== user!.id)
        .filter((m) => {
          const term = mentionQuery.term.toLowerCase();
          return !term
            || m.username.toLowerCase().startsWith(term)
            || m.display_name.toLowerCase().includes(term);
        })
        .slice(0, 6)
    : [];
  const messagesById = new Map(messages.map((m) => [m.id, m]));
  // Media sent as a batch is drawn as one grid; the members after the first render nothing.
  const { albums, absorbed } = buildAlbums(messages);

  return (
    // Row, so the info panel can sit beside the thread on wide screens and the conversation
    // reflows into the remaining width instead of being covered by it.
    <div className="relative flex h-full overflow-hidden">
      <div
        className="relative flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return;
          // Required, or the browser navigates to the dropped file instead of handing it over.
          e.preventDefault();
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepthRef.current = 0;
          setDragging(false);
          stageFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        {dragging && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            style={{ background: 'var(--accent-wash)', border: '2px dashed var(--accent)', borderRadius: 12 }}
          >
            <span className="font-mono text-[13px] px-3 py-1.5 rounded-lg" style={{ background: 'var(--panel)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}>
              Drop to send
            </span>
          </div>
        )}
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-4 flex-shrink-0" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        {onBack && (
          <button onClick={onBack} className="lg:hidden p-2 -ml-1 rounded-xl transition-colors flex-shrink-0 btn-icon" aria-label="Back">
            <FaChevronLeft size={14} />
          </button>
        )}
        <button type="button" onClick={() => setShowInfoPanel(true)} className="flex items-center gap-3 flex-1 min-w-0 rounded-xl -mx-2 px-2 py-1 transition-colors text-left hover-panel-alt">
          <Avatar name={title} avatarUrl={other ? other.avatar_url : conversation.avatar_url} size={36} radius={8} fontSize={14} />
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
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setSearchResults(null); setSearchOpen(false); jumpToMessage(m.id); }}
                  className="w-full text-left px-4 py-3 hover-panel-alt transition-colors"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <p className="text-xs mb-1 font-mono" style={{ color: 'var(--text-dim)' }}>{sndr?.display_name ?? 'Unknown'} · {new Date(m.createdAt).toLocaleString()}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{decodeMessageText(m.ciphertext)}</p>
                </button>
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
      {(openMenuId || emojiBarFor) && <div className="fixed inset-0 z-10" onClick={() => { setOpenMenuId(null); setEmojiBarFor(null); setActivePicker(null); }} />}

      {/* Forward picker modal */}
      {/* ── Forward picker (Telegram-style) ── */}
      {forwardingIds.length > 0 && (() => {
        const q = forwardSearch.toLowerCase();
        const filtered = allConversations.filter((c) =>
          getConversationTitle(c, user!.id).toLowerCase().includes(q)
        );
        return (
          <div className="absolute inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={(e) => { if (e.target === e.currentTarget) { setForwardingIds([]); } }}>
            <div className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ background: 'var(--panel)', border: '1px solid var(--border)', maxHeight: '80vh' }}>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: 'var(--text)' }}>{forwardingIds.length > 1 ? `Forward ${forwardingIds.length} items` : 'Forward message'}</p>
                  <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>
                    {forwardSelected.size === 0 ? 'Choose who to forward to' : `${forwardSelected.size} selected`}
                  </p>
                </div>
                <button type="button" onClick={() => setForwardingIds([])} className="btn-icon" style={{ width: 30, height: 30 }}>
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
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 pt-4 pb-16 flex flex-col"
        style={{ background: 'var(--bg)' }}
        // Fetched a little before the top so the next page is usually in place by the time the
        // reader gets there, rather than stopping them at a spinner.
        onScroll={(e) => { if (e.currentTarget.scrollTop < 240) loadOlderMessages(); }}
      >
        {hasOlder && (
          <div className="flex items-center justify-center py-3 flex-shrink-0">
            {loadingOlder ? (
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>Loading earlier messages…</span>
            ) : (
              <button
                type="button"
                onClick={loadOlderMessages}
                className="text-[11px] font-mono px-3 py-1 rounded-full transition-colors hover-panel-alt"
                style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
              >
                Load earlier messages
              </button>
            )}
          </div>
        )}
        {/* Nothing said yet. Only once the first page is back, and only when the outbox is empty
            too — a message waiting to send is not nothing, and inviting someone to start a
            conversation they have just written in would read as though it had been lost. */}
        {messagesLoaded && messages.length === 0 && outbox.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-1">
            <p className="text-[14px]" style={{ color: 'var(--text-muted)' }}>
              {other ? `This is the start of your conversation with ${other.display_name}.` : 'No messages here yet.'}
            </p>
            <p className="text-[12.5px]" style={{ color: 'var(--text-dim)' }}>
              {other ? 'Say hello.' : 'Send the first message to get things going.'}
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          // Already drawn as a tile in the album its first message opened.
          if (absorbed.has(message.id)) return null;
          const album = albums.get(message.id) ?? null;
          const mine = message.senderId === user!.id;
          // Everyone who has read this far, excluding its sender: whether the author has read
          // their own message is not a question anyone asks.
          const readers = mine
            ? (conversation.members ?? []).filter((m) =>
                m.user_id !== user!.id
                && readCutoffs[m.user_id]
                && new Date(readCutoffs[m.user_id]) >= new Date(message.createdAt))
            : [];
          const read = readers.length > 0;
          const text = decodeMessageText(message.ciphertext);
          const sender = membersById.get(message.senderId ?? '');
          const isEditing = editingMessageId === message.id;
          const isMediaBubble = (message.type === 'image' || message.type === 'video') && !message.deletedAt && !isEditing;
          const deleted = !!message.deletedAt;

          // ── Day divider + consecutive-message grouping ────────────────────
          // startsGroup carries the avatar and the name/time header; endsGroup closes the block.
          const msgDate = new Date(message.createdAt);
          const msgDay = msgDate.toDateString();
          const { startsGroup, startsDay: showDivider } = groupingFor(messages, index);
          // An album stands for every message it absorbed, so whether it closes a block depends on
          // what follows its *last* tile — measuring from the first would look at a member the
          // reader cannot see and leave the bubble permanently mid-block.
          const { endsGroup } = groupingFor(messages, album ? index + album.length - 1 : index);

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
          // A deleted message keeps its slot in the thread but gives up every marker of
          // authorship — no accent fill, no tail pointing back at its sender, no border. It is
          // a placeholder for something that is gone, so it should read as one.
          const bubbleBorderRadius = deleted
            ? `${R}px`
            : mine
              ? `${R}px ${outerTop}px ${outerBottom}px ${R}px`
              : `${outerTop}px ${R}px ${R}px ${outerBottom}px`;
          const bubbleStyle: React.CSSProperties = deleted
            ? { background: 'var(--panel-alt)', border: 'none', color: 'var(--text-dim)', opacity: 0.6 }
            : {
                // Received bubbles carry no border and no shadow: --bubble-in already separates
                // them from the thread background, and outlining every one of them was most of
                // the visual weight. Sent bubbles were already flat, so the two now match.
                background: mine ? 'var(--accent)' : 'var(--bubble-in)',
                border: 'none',
                color: mine ? 'var(--bg-deep)' : 'var(--text-muted)',
              };

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
                  <ReplyPreview
                    type={original.type}
                    file={original.file}
                    ciphertext={original.ciphertext}
                    deleted={!!original.deletedAt}
                    color={mine ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)'}
                    iconColor={mine ? 'rgba(255,255,255,0.8)' : 'var(--accent)'}
                  />
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
              // While selecting, the whole row is the target — hunting for a small checkbox on
              // every message is slower than the thing it is trying to make quick.
              onClick={selectMode && !message.deletedAt ? () => toggleSelected(message.id) : undefined}
              className={`flex items-start gap-2 group ${startsGroup ? 'mt-3' : 'mt-1'} ${mine ? 'flex-row-reverse' : 'flex-row'} transition-colors duration-300 ${selectMode && !message.deletedAt ? 'cursor-pointer' : ''}`}
              style={
                selectedIds.has(message.id)
                  ? { background: 'var(--accent-wash)', borderRadius: 12, margin: '4px -4px', padding: '0 4px' }
                  : highlightedMsgId === message.id
                    ? { background: 'var(--accent-wash)', borderRadius: 12, margin: '12px -4px', padding: '0 4px' }
                    : undefined
              }
            >
              {/* Avatar — on the message that opens the block, so it sits level with the name
                  header. Later messages keep the indent with a spacer, and that spacer doubles
                  as the slot for this message's time: the gutter is already reserved, so
                  revealing the time on hover shifts nothing. It is absolutely positioned and
                  wider than the 32px gutter so a 12-hour "10:32 PM" still fits, growing away
                  from the bubble rather than into it. */}
              {!startsGroup ? (
                <div className="flex-shrink-0 relative" style={{ width: 32 }}>
                  <span
                    className="absolute top-0 whitespace-nowrap text-[10px] font-mono leading-none opacity-0 group-hover:opacity-100 transition-opacity select-none"
                    style={{
                      [mine ? 'left' : 'right']: 0,
                      // 48 is the widest this can be without pushing past the scroll
                      // container's 16px padding and giving the whole thread a horizontal
                      // scrollbar: 16 + 32 (gutter) - 48 lands exactly on the edge.
                      width: 48,
                      paddingTop: 15,
                      textAlign: mine ? 'left' : 'right',
                      color: 'var(--text-dim)',
                    }}
                  >
                    {msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
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

                {/* Name + timestamp — only on the message that opens the block. Shown for
                    deleted messages too: the avatar renders regardless, so suppressing just the
                    name left an avatar captioned by nothing. Who posted is not the secret. */}
                {startsGroup && (
                  <div className="flex items-baseline gap-2 mb-1 px-1" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                    <span className="text-[13px] font-semibold" style={{ color: mine ? 'var(--accent)' : 'var(--text)' }}>
                      {mine ? 'You' : sender?.display_name ?? 'Unknown'}
                    </span>
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      {msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {mine && read && (
                        <span
                          title={readers.map((r) => r.display_name).join(', ')}
                          className="cursor-default"
                        >
                          {' · ✓✓'}
                          {/* In a direct conversation "read" is unambiguous; in a group the
                              useful part is how many of them, and by whom. */}
                          {isGroup && ` ${readers.length}`}
                        </span>
                      )}
                    </span>
                    {bookmarkIds.has(message.id) && (
                      <FaBookmark size={12} className="flex-shrink-0" style={{ color: 'var(--warning)' }} />
                    )}
                  </div>
                )}

                {/* Bubble, reactions and the popover share a wrapper whose top edge is the
                    bubble's top edge — so the popover anchors directly above the bubble rather
                    than above the name header, which sits higher up in the column. */}
                <div
                  className="relative flex flex-col max-w-full"
                  style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}
                  // Anchored to the bubble, not the row: the row spans the full width, so
                  // hovering empty space far from the message used to summon its picker.
                  onMouseEnter={(e) => { keepPickerOpen(); calcToolbarDir(e.currentTarget, message.id); schedulePicker(e.currentTarget, message.id); }}
                  // Leaving only dismisses it when the menu is closed, so the menu does not
                  // vanish the moment the pointer travels toward it.
                  onMouseLeave={() => {
                    cancelScheduledPicker();
                    if (openMenuId !== message.id && emojiBarFor !== message.id) {
                      closePickerSoon(message.id);
                    }
                  }}
                  // Touch has no hover, so a long press stands in for it.
                  onTouchStart={(e) => {
                    const el = e.currentTarget;
                    longPressRef.current = window.setTimeout(() => { calcToolbarDir(el, message.id); openPicker(el, message.id); }, 450);
                  }}
                  onTouchEnd={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); }}
                  onTouchMove={() => { if (longPressRef.current) window.clearTimeout(longPressRef.current); }}
                >
                {/* Bubble */}
                {isMediaBubble ? (
                  <div className="relative overflow-hidden max-w-full" style={{ borderRadius: bubbleBorderRadius }}>
                    {message.replyToMessageId && (
                      <div className="px-3 pt-2.5 pb-2" style={{ background: mine ? 'var(--accent)' : 'var(--bubble-in)', borderBottom: '1px solid var(--border)' }}>
                        <ReplyQuote replyId={message.replyToMessageId} />
                      </div>
                    )}
                    {album
                      ? <MessageAlbum messages={album} onOpen={openLightbox} />
                      : <MessageAttachment type={message.type} file={message.file} isMine={mine} compact onOpen={openLightbox} />}
                    {/* Same rule as a text bubble: the time recedes to hover, because the block
                        header above already states it. It stays put only when the pill also
                        carries state — edited, or read — which nothing else on a media bubble
                        reports. White on a scrim rather than --text-dim, since it sits over
                        arbitrary imagery. */}
                    <span className={`absolute bottom-2 right-2 text-[10px] font-mono text-white bg-black/45 rounded-full px-1.5 py-0.5 select-none transition-opacity ${message.editedAt || (mine && read) ? '' : 'opacity-0 group-hover:opacity-100'}`}>
                      {msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {message.editedAt && ' (edited)'}{mine && read && ' ✓✓'}
                    </span>
                  </div>
                ) : (
                  <div className="px-4 py-2.5" title={msgDate.toLocaleString()} style={{ borderRadius: bubbleBorderRadius, ...bubbleStyle }}>
                    {/* The reply quote is suppressed once deleted: nothing remains to give it
                        context, and its accent styling fought the receded bubble. */}
                    {!deleted && message.replyToMessageId && <ReplyQuote replyId={message.replyToMessageId} />}
                    {deleted ? (
                      <p className="text-sm italic">This message was deleted</p>
                    ) : (<>
                      {message.type !== 'text' && <MessageAttachment type={message.type} file={message.file} isMine={mine} onOpen={openLightbox} />}
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
                          <MessageText
                            text={text}
                            usernames={memberUsernames}
                            currentUsername={user!.username}
                            linkStyle={{ color: mine ? 'var(--bg-deep)' : 'var(--accent)' }}
                            mentionStyle={{ color: mine ? 'var(--bg-deep)' : 'var(--accent)' }}
                            // A mention of you is washed rather than merely coloured, so scanning
                            // a busy thread finds it without reading every line.
                            selfMentionStyle={mine
                              ? { color: 'var(--bg-deep)', background: 'rgba(0,0,0,0.12)' }
                              : { color: 'var(--accent)', background: 'var(--accent-wash)' }}
                          />
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
                      <span className="block text-right text-[10px] mt-1 select-none italic font-mono" style={{ color: mine ? 'rgba(8,10,15,0.5)' : 'var(--text-dim)' }}>(edited)</span>
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
                    {groupReactions(message.reactions ?? [], user!.id).map(({ emoji, count, mine: iMine, names }) => {
                      const showing = reactionTip?.messageId === message.id && reactionTip.emoji === emoji;
                      return (
                        <div key={emoji} className="relative">
                          <button
                            onClick={() => toggleReaction(message.id, emoji)}
                            // Clicking still toggles your own reaction; who reacted is a
                            // different question, so it is answered by hovering rather than by
                            // taking the tap away from the thing the pill is for.
                            onMouseEnter={() => setReactionTip({ messageId: message.id, emoji })}
                            onMouseLeave={() => setReactionTip((t) => (t?.emoji === emoji && t.messageId === message.id ? null : t))}
                            onFocus={() => setReactionTip({ messageId: message.id, emoji })}
                            onBlur={() => setReactionTip(null)}
                            // Touch has no hover, so a long press asks the same question.
                            onTouchStart={() => {
                              reactionTipRef.current = window.setTimeout(
                                () => setReactionTip({ messageId: message.id, emoji }), 400);
                            }}
                            onTouchEnd={() => { if (reactionTipRef.current) window.clearTimeout(reactionTipRef.current); }}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] border transition-all"
                            style={iMine
                              ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                              : { background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                          >
                            {emoji} <span className={iMine ? 'font-bold' : 'font-medium'}>{count}</span>
                          </button>

                          {showing && (
                            <div
                              className={`absolute z-40 bottom-full mb-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 pointer-events-none ${mine ? 'right-0' : 'left-0'}`}
                              style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 4px 14px rgba(0,0,0,0.28)' }}
                            >
                              <span className="text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                                {emoji} {names.join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              {/* Hover controls — two small icons beside the bubble. The five quick reactions
                  used to sit open next to every hovered message, which is a lot of colour for
                  something you mostly scroll past; they now live behind the smiley. */}
              {selectMode && (
                <span
                  className="flex-shrink-0 self-center w-5 h-5 rounded-full flex items-center justify-center"
                  style={{
                    background: selectedIds.has(message.id) ? 'var(--accent)' : 'transparent',
                    border: `1.5px solid ${selectedIds.has(message.id) ? 'var(--accent)' : 'var(--border)'}`,
                    opacity: message.deletedAt ? 0.3 : 1,
                  }}
                >
                  {selectedIds.has(message.id) && <FaCheck size={10} className="text-white" />}
                </span>
              )}

              {!selectMode && activePicker?.id === message.id && !isEditing && !message.deletedAt && (
                <div
                  className={`absolute z-30 flex items-center gap-0.5 top-1/2 -translate-y-1/2 ${mine ? 'right-full pr-1' : 'left-full pl-1'}`}
                  // Entering the controls cancels the pending close; they are a DOM child of the
                  // bubble wrapper, and their box touches it, so there is no gap to fall through.
                  onMouseEnter={keepPickerOpen}
                  onMouseLeave={() => { if (openMenuId !== message.id && emojiBarFor !== message.id) closePickerSoon(message.id); }}
                >
                  <div className="relative">
                    <button type="button" title="React" aria-label="React"
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); setEmojiBarFor(emojiBarFor === message.id ? null : message.id); }}
                      className="w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors hover-panel-alt"
                      style={{ color: 'var(--text-dim)' }}>
                      <FaRegFaceSmile size={14} />
                    </button>
                    {emojiBarFor === message.id && (
                      <div className={`absolute z-40 ${activePicker.dir === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} ${mine ? 'right-0' : 'left-0'}`}>
                        <div className="flex items-center rounded-2xl" style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 4px 14px rgba(0,0,0,0.28)' }}>
                          {QUICK_EMOJIS.map((e) => (
                            <button key={e} onClick={() => { toggleReaction(message.id, e); setEmojiBarFor(null); }}
                              className="flex w-8 h-8 text-[16px] items-center justify-center transition-colors first:rounded-l-2xl last:rounded-r-2xl hover-panel-alt">{e}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                      <button type="button" title="More actions" aria-label="More actions"
                        onClick={(e) => { e.stopPropagation(); calcToolbarDir(e.currentTarget, message.id); setEmojiBarFor(null); setOpenMenuId(openMenuId === message.id ? null : message.id); }}
                        className="w-[26px] h-[26px] rounded-full flex items-center justify-center transition-colors hover-panel-alt" style={{ color: 'var(--text-dim)' }}>
                        <FaEllipsisVertical size={14} />
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

                          {/* 3c. Select — starts a multi-selection with this message in it */}
                          {!message.deletedAt && (
                            <button type="button" onClick={() => beginSelecting(message.id)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
                              <FaCheck size={13} style={{ color: 'var(--text-dim)' }} />
                              Select
                            </button>
                          )}

                          {/* 4. Forward */}
                          {!message.deletedAt && (
                            <button type="button" onClick={() => { openForwardPicker([message.id]); setOpenMenuId(null); }}
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
              )}
                </div>{/* end bubble + reactions wrap */}
              </div>{/* end column */}
            </div>
            </div>
          );
        })}
        {/* Waiting to be sent. Drawn after the thread because that is where they will land, and
            dimmed so they read as not-yet-here rather than as ordinary messages. */}
        {outbox.map((item) => (
          <div key={item.id} className="flex items-start gap-2 mt-1 flex-row-reverse">
            <div className="flex-shrink-0" style={{ width: 32 }} />
            <div className="flex flex-col max-w-[80%] sm:max-w-[62%]" style={{ alignItems: 'flex-end' }}>
              <div
                className="px-4 py-2.5"
                style={{
                  borderRadius: 16,
                  background: 'var(--accent)',
                  color: 'var(--bg-deep)',
                  opacity: item.state === 'failed' ? 0.55 : 0.7,
                }}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{item.text}</p>
              </div>
              <span className="mt-0.5 text-[10px] font-mono flex items-center gap-1.5"
                style={{ color: item.state === 'failed' ? 'var(--danger)' : 'var(--text-dim)' }}>
                {item.state === 'failed' ? (
                  <>
                    {item.error ?? 'Not sent'}
                    <button type="button" onClick={() => flushOutbox()}
                      className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>
                      Retry
                    </button>
                    <button type="button"
                      onClick={() => setOutbox((prev) => prev.filter((o) => o.id !== item.id))}
                      className="underline underline-offset-2" style={{ color: 'var(--text-dim)' }}>
                      Discard
                    </button>
                  </>
                ) : 'Sending…'}
              </span>
            </div>
          </div>
        ))}

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
            <div className="mt-0.5 leading-tight">
              <ReplyPreview
                type={replyingTo.type}
                file={replyingTo.file}
                ciphertext={replyingTo.ciphertext}
                deleted={!!replyingTo.deletedAt}
                color="var(--text-dim)"
                iconColor="var(--accent)"
              />
            </div>
          </div>
          <button type="button" onClick={() => setReplyingTo(null)} className="p-1.5 rounded-lg transition-colors flex-shrink-0 hover-panel-alt" style={{ color: 'var(--text-dim)' }} aria-label="Cancel reply">
            <FaXmark size={14} />
          </button>
        </div>
      )}

      {/* Input bar */}
      {/* Replaces the composer rather than sitting above it: while selecting, sending is not
          what the bar is for, and leaving both would offer two different jobs at once. */}
      {selectMode && (
        <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
          style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={exitSelecting} className="btn-icon" style={{ width: 32, height: 32 }} aria-label="Cancel selection">
            <FaXmark size={13} />
          </button>
          <span className="flex-1 text-[12px] font-mono" style={{ color: 'var(--text-dim)' }}>
            {selectedIds.size === 0 ? 'Select messages' : `${selectedIds.size} selected`}
          </span>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => { openForwardPicker([...selectedIds]); exitSelecting(); }}
            className="btn-ghost disabled:opacity-35"
            style={{ padding: '6px 12px' }}
          >
            <FaShare size={12} /> Forward
          </button>
          {user?.role === 'admin' && (
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={async () => { const ids = [...selectedIds]; exitSelecting(); await deleteMessages(ids); }}
              className="btn-ghost disabled:opacity-35"
              style={{ padding: '6px 12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
            >
              <FaTrash size={12} /> Delete
            </button>
          )}
        </div>
      )}

      {!selectMode && mentionCandidates.length > 0 && (
        <div className="mx-4 mb-1 rounded-xl overflow-hidden flex-shrink-0"
          style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 -4px 14px rgba(0,0,0,0.18)' }}>
          {mentionCandidates.map((m, i) => (
            <button
              key={m.user_id}
              type="button"
              // Chosen on mousedown, not click: click lands after the textarea has already lost
              // focus, which closes the picker before the choice arrives.
              onMouseDown={(e) => { e.preventDefault(); applyMention(m.username); }}
              onMouseEnter={() => setMentionIndex(i)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
              style={{ background: i === mentionIndex ? 'var(--accent-wash)' : 'transparent' }}
            >
              <Avatar name={m.display_name} avatarUrl={m.avatar_url} size={26} radius={7} fontSize={11} />
              <span className="text-[13px] truncate" style={{ color: 'var(--text)' }}>{m.display_name}</span>
              <span className="text-[11px] font-mono truncate" style={{ color: 'var(--text-dim)' }}>@{m.username}</span>
            </button>
          ))}
        </div>
      )}

      {/* Staged attachments — chosen, not yet sent. Thumbnails rather than filenames, because
          what matters before sending is whether this is the right picture. */}
      {staged.length > 0 && (
        <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto flex-shrink-0" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
          {staged.map((f) => (
            <div key={f.id} className="relative flex-shrink-0" style={{ width: 72 }}>
              <div
                className="relative overflow-hidden flex items-center justify-center"
                style={{ width: 72, height: 72, borderRadius: 10, background: 'var(--panel-alt)', border: '1px solid var(--border)' }}
              >
                {f.previewUrl && f.file.type.startsWith('image/') && (
                  <img src={f.previewUrl} alt="" className="w-full h-full object-cover" />
                )}
                {f.previewUrl && f.file.type.startsWith('video/') && (
                  <video src={f.previewUrl} muted preload="metadata" className="w-full h-full object-cover" />
                )}
                {!f.previewUrl && <FaPaperclip size={18} style={{ color: 'var(--text-dim)' }} />}

                {f.status === 'uploading' && (
                  <div className="absolute inset-0 flex items-end" style={{ background: 'rgba(0,0,0,0.45)' }}>
                    <div className="w-full h-[3px]" style={{ background: 'rgba(255,255,255,0.25)' }}>
                      <div className="h-full transition-[width] duration-150" style={{ width: `${Math.round(f.progress * 100)}%`, background: 'var(--accent)' }} />
                    </div>
                  </div>
                )}
                {f.status === 'failed' && (
                  <button
                    type="button"
                    onClick={() => sendStaged(f, undefined)}
                    title={f.error}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-white"
                    style={{ background: 'rgba(0,0,0,0.6)' }}
                  >
                    <FaArrowRotateRight size={14} />
                    <span className="text-[9px] font-mono">Retry</span>
                  </button>
                )}
              </div>

              {f.status !== 'uploading' && (
                <button
                  type="button"
                  onClick={() => unstage(f.id)}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                  aria-label={`Remove ${f.file.name}`}
                >
                  <FaXmark size={10} />
                </button>
              )}
              {/* Only for media: everything else can only be sent as a file, so a choice would
                  be a control with one option. */}
              {(f.file.type.startsWith('image/') || f.file.type.startsWith('video/')) && f.status !== 'uploading' && (
                <div className="mt-1 flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  {(['media', 'file'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setStaged((prev) => prev.map((x) => (x.id === f.id ? { ...x, mode } : x)))}
                      title={mode === 'media'
                        ? 'Shown in the conversation, resized a little'
                        : 'Sent as a download, at its original size'}
                      className="flex-1 text-[9.5px] font-mono py-0.5 transition-colors"
                      style={f.mode === mode
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'transparent', color: 'var(--text-dim)' }}
                    >
                      {mode === 'media' ? (f.file.type.startsWith('video/') ? 'Video' : 'Photo') : 'File'}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[10px] truncate" style={{ color: 'var(--text-dim)' }} title={f.file.name}>{f.file.name}</p>
            </div>
          ))}
        </div>
      )}

      {/* items-end, not items-center: the composer grows upward with its content, and centring
          would drag the attach and send buttons up the side of a tall message. */}
      {!selectMode && <form className="flex items-end gap-2 px-4 pt-3 flex-shrink-0" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }} onSubmit={handleSend}>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || isRecording} title="Attach file" className="disabled:opacity-40 disabled:cursor-not-allowed btn-icon">
          <FaPaperclip size={14} />
        </button>
        <button type="button" onClick={isRecording ? stopRecording : startRecording} disabled={uploading} title={isRecording ? 'Stop recording' : 'Record voice note'}
          className={`disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 ${isRecording ? 'rounded-lg' : 'btn-icon'}`}
          style={isRecording ? { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', background: 'var(--danger-wash)', border: '1px solid var(--danger-border)' } : undefined}>
          <FaMicrophone size={14} />
        </button>
        <textarea
          ref={composerRef}
          rows={1}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          onPaste={handleComposerPaste}
          placeholder={isRecording ? 'Recording...' : uploading ? 'Uploading...' : replyingTo ? 'Reply...' : 'Message...'}
          autoComplete="off"
          disabled={isRecording || uploading}
          // resize-none because the grip would fight the auto-grow, and the height is already
          // driven by the content.
          className="input-base flex-1 disabled:opacity-60 resize-none"
          style={{ maxHeight: COMPOSER_MAX_HEIGHT, overflowY: 'auto', lineHeight: 1.45 }}
        />
        <button type="submit" disabled={(!input.trim() && staged.length === 0) || uploading || isRecording || sending} title="Send" className="btn-primary disabled:opacity-40">
          <FaPaperPlane size={14} />
        </button>
      </form>}

      {/* Jumping can take several requests when the target is far back, so it says so rather
          than appearing to have ignored the click. */}
      {jumping && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-mono"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-muted)', boxShadow: '0 4px 14px rgba(0,0,0,0.28)' }}>
            <span className="w-3 h-3 rounded-full animate-spin" style={{ border: '2px solid var(--border)', borderTopColor: 'var(--accent)' }} />
            Finding that message…
          </span>
        </div>
      )}

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
            <ConversationInfoPanel conversation={conversation} currentUserId={user!.id} presence={presence} onClose={() => setShowInfoPanel(false)} onOpenLightbox={openLightbox} onJumpToMessage={jumpToMessage}
              onAvatarUpdated={(avatarUrl) => {
                // Repaint the header and panel from local state, then tell the page so the
                // conversation list picks it up too — all three read the same field.
                setConversation((c) => (c ? { ...c, avatar_url: avatarUrl } : c));
                onConversationAvatarChanged?.(conversationId, avatarUrl);
              }}
              onForwardMessages={openForwardPicker}
              onDeleteMessages={deleteMessages}
              canDeleteMessages={user?.role === 'admin'}
              onConversationUpdated={(updated) => {
                setConversation(updated);
                onConversationChanged?.(updated);
              }}
              onLeft={() => {
                setShowInfoPanel(false);
                onConversationLeft?.(conversationId);
              }}
              initialTab="media" />
          </aside>
        </>
      )}

      {lightbox && <Lightbox items={lightbox.items} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}

      {confirmDialog}

      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      `}</style>
    </div>
  );
}
