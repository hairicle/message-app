'use client';

import { useEffect, useRef, useState } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import type {
  Conversation,
  ConversationAttachmentItem,
  ConversationMediaItem,
  FileMeta,
  MessageType,
} from '@messenger/shared';
import { useFileBlobUrl } from '../hooks/useFileBlobUrl';
import { getConversationTitle, getOtherMember } from '../utils/conversation';
import { formatFileSize } from '../utils/format';
import { FaCamera, FaCheck, FaEye, FaShare, FaTrash, FaXmark } from 'react-icons/fa6';
import { Avatar, Badge } from './ui';
import { AvatarCropDialog } from './AvatarCropDialog';
import { fileTypeMeta, VoicePlayer } from './MessageAttachment';

export type InfoTab = 'media' | 'files' | 'voice';

/** How a shared item responds to pointer input, identical across the three tabs. */
interface ItemInteraction {
  selectMode: boolean;
  selected: boolean;
  /** Click, or tap: jumps to the message, or toggles selection while selecting. */
  onActivate: () => void;
  onMenu: (x: number, y: number) => void;
  onLongPressStart: (x: number, y: number) => void;
  onLongPressEnd: () => void;
}

/** Props every tab item spreads onto its root element. */
function interactionProps(ui: ItemInteraction) {
  return {
    onClick: ui.onActivate,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); ui.onMenu(e.clientX, e.clientY); },
    onTouchStart: (e: React.TouchEvent) => ui.onLongPressStart(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: ui.onLongPressEnd,
    onTouchMove: ui.onLongPressEnd,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.onActivate(); }
    },
    role: 'button' as const,
    tabIndex: 0,
  };
}

interface Props {
  conversation: Conversation;
  currentUserId: string;
  presence: Record<string, 'online' | 'offline'>;
  onClose: () => void;
  onOpenLightbox: (file: FileMeta, type: MessageType) => void;
  /** Scroll the thread to a shared item's original message and flash it, as a reply quote does. */
  onJumpToMessage: (messageId: string) => void;
  /** Called with the new object key after a group picture upload, so the list, header and this
   *  panel all repaint without waiting for a refetch. */
  onAvatarUpdated: (avatarUrl: string | null) => void;
  /** Hand a selection to the thread's forward picker — one message or many. */
  onForwardMessages: (messageIds: string[]) => void;
  onDeleteMessages: (messageIds: string[]) => void;
  /** Mirrors the thread's rule: deleting someone else's message is an admin action. */
  canDeleteMessages: boolean;
  initialTab?: InfoTab;
}

export function ConversationInfoPanel({
  conversation,
  currentUserId,
  presence,
  onClose,
  onOpenLightbox,
  onJumpToMessage,
  onAvatarUpdated,
  onForwardMessages,
  onDeleteMessages,
  canDeleteMessages,
  initialTab = 'media',
}: Props) {
  const [activeTab, setActiveTab] = useState<InfoTab>(initialTab);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // Long-press / right-click menu, positioned at the pointer like Telegram's.
  const [menuFor, setMenuFor] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const longPressRef = useRef<number | null>(null);
  const [media, setMedia] = useState<ConversationMediaItem[] | null>(null);
  const [files, setFiles] = useState<ConversationAttachmentItem[] | null>(null);
  const [voice, setVoice] = useState<ConversationAttachmentItem[] | null>(null);

  const title = getConversationTitle(conversation, currentUserId);
  const other = conversation.type === 'direct' ? getOtherMember(conversation, currentUserId) : null;
  const isOnline = other ? presence[other.user_id] === 'online' : false;
  const isGroup = conversation.type !== 'direct';
  const members = conversation.members ?? [];
  // Mirrors the server's rule. The server re-checks it — this only decides whether to offer it.
  const myRole = members.find((m) => m.user_id === currentUserId)?.role;
  const canEditAvatar = isGroup && (myRole === 'owner' || myRole === 'admin');

  function toggleSelected(messageId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  /** The interaction every shared item shares, whichever tab it lives in. */
  function itemUi(messageId: string): ItemInteraction {
    return {
      selectMode,
      selected: selected.has(messageId),
      onActivate: () => (selectMode ? toggleSelected(messageId) : onJumpToMessage(messageId)),
      onMenu: (x, y) => setMenuFor({ messageId, x, y }),
      onLongPressStart: (x, y) => {
        longPressRef.current = window.setTimeout(() => setMenuFor({ messageId, x, y }), 450);
      },
      onLongPressEnd: () => {
        if (longPressRef.current) window.clearTimeout(longPressRef.current);
      },
    };
  }

  async function handleCroppedAvatar(blob: Blob) {
    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const { conversation: updated } = await conversationsApi.uploadConversationAvatar(conversation.id, blob);
      onAvatarUpdated(updated.avatar_url);
      setPendingAvatar(null);
    } catch (err) {
      setAvatarError((err as Error).message || 'Could not update the picture');
    } finally {
      setUploadingAvatar(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'media' && media === null) {
      conversationsApi
        .getConversationMedia(conversation.id)
        .then(({ media: items }) => setMedia(items))
        .catch(() => setMedia([]));
    }
    if (activeTab === 'files' && files === null) {
      conversationsApi
        .getConversationAttachments(conversation.id, ['file'])
        .then(({ items }) => setFiles(items))
        .catch(() => setFiles([]));
    }
    if (activeTab === 'voice' && voice === null) {
      conversationsApi
        .getConversationAttachments(conversation.id, ['audio'])
        .then(({ items }) => setVoice(items))
        .catch(() => setVoice([]));
    }
  }, [activeTab, conversation.id, media, files, voice]);

  const TABS: { id: InfoTab; label: string }[] = [
    { id: 'media', label: 'Media' },
    { id: 'files', label: 'Files' },
    { id: 'voice', label: 'Voice' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)', fontFamily: 'var(--font-sans)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <h2 className="font-mono text-[13px] uppercase tracking-widest flex-1" style={{ color: 'var(--text-dim)' }}>Info</h2>
        <button type="button" onClick={onClose} className="btn-icon" style={{ width: 30, height: 30 }} aria-label="Close panel">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile section */}
        <div className="flex flex-col items-center px-6 py-6" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* A group has its own picture; a direct conversation shows the other person's. The
              panel used to read `other?.avatar_url` unconditionally, so a group avatar could
              never appear here however it was set. */}
          {isGroup ? (
            <div className="relative mb-3 group" style={{ width: 72, height: 72 }}>
              <Avatar name={title} avatarUrl={conversation.avatar_url} size={72} radius={18} fontSize={26} />
              {canEditAvatar && (
                <>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    style={{ borderRadius: 18, background: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    title="Change group picture"
                    aria-label="Change group picture"
                  >
                    <FaCamera size={18} />
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files?.[0];
                      // Cleared so re-picking the same file still fires a change event.
                      e.target.value = '';
                      if (picked) setPendingAvatar(picked);
                    }}
                  />
                </>
              )}
            </div>
          ) : (
            <Avatar name={title} avatarUrl={other?.avatar_url} size={72} radius={18} fontSize={26} className="mb-3" profileUserId={other?.user_id} />
          )}
          {avatarError && (
            <p className="text-[11px] text-center mb-2" style={{ color: 'var(--danger)' }}>{avatarError}</p>
          )}
          <h3 className="font-bold text-[16px] text-center leading-snug" style={{ color: 'var(--text)' }}>{title}</h3>

          {other && (
            <span className="text-[12px] mt-1.5 font-mono font-medium" style={{ color: isOnline ? 'var(--accent)' : 'var(--text-dim)' }}>
              {isOnline ? '● Online' : '○ Offline'}
            </span>
          )}
          {other?.username && (
            <span className="text-[12px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>@{other.username}</span>
          )}
          {isGroup && (
            <span className="text-[12px] font-mono mt-1.5" style={{ color: 'var(--text-dim)' }}>{members.length} members</span>
          )}

          {/* Group member list */}
          {isGroup && members.length > 0 && (
            <div className="w-full mt-4 space-y-2">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2.5 py-0.5">
                  <Avatar name={m.display_name} avatarUrl={m.avatar_url} size={32} radius={8} fontSize={12}
                    showPresence={m.user_id !== currentUserId} online={presence[m.user_id] === 'online'} profileUserId={m.user_id} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium truncate leading-tight" style={{ color: 'var(--text)' }}>{m.display_name}</p>
                    <p className="text-[11.5px] font-mono capitalize leading-tight mt-0.5" style={{ color: 'var(--text-dim)' }}>{m.role}</p>
                  </div>
                  {(m.role === 'owner' || m.role === 'admin') && (
                    <Badge tone="warning">{m.role}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex px-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          {TABS.map(({ id, label }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                // Selection is per tab: carrying picks across would let a Forward act on items
                // no longer visible.
                onClick={() => { setActiveTab(id); exitSelect(); }}
                className="flex-1 py-2.5 px-2 font-mono text-[12.5px] font-medium border-b-2 transition-colors"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-dim)', marginBottom: '-1px' }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'media' && (
          media === null ? <TabLoading /> : media.length === 0 ? (
            <TabEmpty label="No media shared yet." />
          ) : (
            // Same p-3 inset as the Files and Voice tabs — the grid used to run edge to edge,
            // which read as a misalignment against every other row in the panel.
            <div className="p-3 grid grid-cols-3 gap-1.5">
              {media.map((item) => (
                <MediaThumb key={item.file.id} item={item} onOpen={onOpenLightbox} ui={itemUi(item.messageId)} />
              ))}
            </div>
          )
        )}

        {activeTab === 'files' && (
          files === null ? <TabLoading /> : files.length === 0 ? (
            <TabEmpty label="No files shared yet." />
          ) : (
            <div className="p-3 space-y-1">
              {files.map((item) => (
                <FileItem key={item.file.id} item={item} ui={itemUi(item.messageId)} />
              ))}
            </div>
          )
        )}

        {activeTab === 'voice' && (
          voice === null ? <TabLoading /> : voice.length === 0 ? (
            <TabEmpty label="No voice notes shared yet." />
          ) : (
            <div className="p-3 space-y-1">
              {voice.map((item) => (
                <VoiceItem key={item.file.id} item={item} ui={itemUi(item.messageId)} />
              ))}
            </div>
          )
        )}
      </div>

      {/* Selection bar — replaces the tab content's actions while picking. */}
      {selectMode && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 flex-shrink-0"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--panel)' }}
        >
          <button type="button" onClick={exitSelect} className="btn-icon" style={{ width: 30, height: 30 }} aria-label="Cancel selection">
            <FaXmark size={13} />
          </button>
          <span className="flex-1 text-[12px] font-mono" style={{ color: 'var(--text-dim)' }}>
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => { onForwardMessages([...selected]); exitSelect(); }}
            className="btn-ghost disabled:opacity-35"
            style={{ padding: '6px 12px' }}
          >
            <FaShare size={12} /> Forward
          </button>
          {canDeleteMessages && (
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => { onDeleteMessages([...selected]); exitSelect(); }}
              className="btn-ghost disabled:opacity-35"
              style={{ padding: '6px 12px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }}
            >
              <FaTrash size={12} /> Delete
            </button>
          )}
        </div>
      )}

      {/* Item menu. Fixed to the pointer, clamped so it cannot open off-screen. */}
      {menuFor && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} onContextMenu={(e) => { e.preventDefault(); setMenuFor(null); }} />
          <div
            className="fixed z-50 w-48 rounded-xl overflow-hidden py-1"
            style={{
              top: Math.min(menuFor.y, typeof window !== 'undefined' ? window.innerHeight - 200 : menuFor.y),
              left: Math.min(menuFor.x, typeof window !== 'undefined' ? window.innerWidth - 200 : menuFor.x),
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            }}
          >
            <button type="button" onClick={() => { onJumpToMessage(menuFor.messageId); setMenuFor(null); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
              <FaEye size={13} style={{ color: 'var(--text-dim)' }} /> Go to message
            </button>
            <button type="button" onClick={() => { onForwardMessages([menuFor.messageId]); setMenuFor(null); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
              <FaShare size={13} style={{ color: 'var(--text-dim)' }} /> Forward
            </button>
            {canDeleteMessages && (
              <button type="button" onClick={() => { onDeleteMessages([menuFor.messageId]); setMenuFor(null); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--danger)' }}>
                <FaTrash size={13} /> Delete
              </button>
            )}
            <div className="h-px mx-3 my-1" style={{ background: 'var(--border)' }} />
            <button type="button"
              onClick={() => { setSelectMode(true); setSelected(new Set([menuFor.messageId])); setMenuFor(null); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover-panel-alt" style={{ color: 'var(--text-muted)' }}>
              <FaCheck size={13} style={{ color: 'var(--text-dim)' }} /> Select
            </button>
          </div>
        </>
      )}

      {pendingAvatar && (
        <AvatarCropDialog
          file={pendingAvatar}
          busy={uploadingAvatar}
          onCancel={() => setPendingAvatar(null)}
          onConfirm={handleCroppedAvatar}
        />
      )}
    </div>
  );
}

function TabLoading() {
  return (
    <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-dim)' }}>
      <svg className="w-5 h-5 animate-spin mx-auto mb-2" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      Loading…
    </div>
  );
}

function TabEmpty({ label }: { label: string }) {
  return <div className="py-12 text-center text-[13px]" style={{ color: 'var(--text-dim)' }}>{label}</div>;
}

function MediaThumb({
  item,
  onOpen,
  ui,
}: {
  item: ConversationMediaItem;
  onOpen: (file: FileMeta, type: MessageType) => void;
  ui: ItemInteraction;
}) {
  const variant = item.type === 'image' && item.file.hasThumbnail ? 'thumbnail' : 'original';
  const url = useFileBlobUrl(item.file.id, variant);

  return (
    <div
      {...interactionProps(ui)}
      className="group relative aspect-square overflow-hidden rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
      style={{
        background: 'var(--panel-alt)',
        border: ui.selected ? '2px solid var(--accent)' : '1px solid var(--border)',
      }}
    >
      {ui.selectMode && (
        <span
          className="absolute bottom-1 left-1 z-10 w-5 h-5 rounded-full flex items-center justify-center"
          style={{
            background: ui.selected ? 'var(--accent)' : 'rgba(0,0,0,0.45)',
            border: `1.5px solid ${ui.selected ? 'var(--accent)' : 'rgba(255,255,255,0.7)'}`,
          }}
        >
          {ui.selected && <FaCheck size={10} className="text-white" />}
        </span>
      )}
      {/* Opening the viewer stays reachable — the tile's own click now goes to the message,
          and losing the viewer entirely would be a worse trade than a second affordance. */}
      <button
        type="button"
        title="Open"
        onClick={(e) => { e.stopPropagation(); onOpen(item.file, item.type as MessageType); }}
        // Hidden while selecting: the tile's job is then to be picked, not opened.
        hidden={ui.selectMode}
        className="absolute top-1 right-1 z-10 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
      </button>
      {url && item.type === 'image' && (
        <img src={url} alt="" className="w-full h-full object-cover" />
      )}
      {url && item.type === 'video' && (
        <>
          <video src={url} preload="metadata" muted className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </>
      )}
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full animate-spin" style={{ border: '2px solid var(--border)', borderTopColor: 'transparent' }} />
        </div>
      )}
    </div>
  );
}

function FileItem({ item, ui }: { item: ConversationAttachmentItem; ui: ItemInteraction }) {
  const url = useFileBlobUrl(item.file.id, 'original');
  const { label: extLabel, color: extColor } = fileTypeMeta(item.file.fileName);

  return (
    // The row jumps to the message; downloading stays on the icon at the end of it, so the
    // panel does not lose the one action it previously had.
    <div
      {...interactionProps(ui)}
      className="flex items-center gap-3 p-2.5 rounded-xl transition-colors group hover-panel-alt cursor-pointer"
      style={ui.selected ? { background: 'var(--accent-wash)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' } : undefined}
    >
      <span className="flex-shrink-0 rounded-lg flex items-center justify-center relative" style={{ width: 40, height: 40, background: `${extColor}22` }}>
        <svg className="w-[18px] h-[18px]" fill="none" stroke={extColor} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 2.25H15a.75.75 0 01.53.22l4.5 4.5a.75.75 0 01.22.53V19.5A2.25 2.25 0 0118 21.75H6A2.25 2.25 0 013.75 19.5V4.5A2.25 2.25 0 016 2.25h3z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M14.25 2.25v4.5a.75.75 0 00.75.75h4.5" />
        </svg>
        {extLabel && (
          <span className="absolute -bottom-1 px-1 rounded font-mono font-bold leading-tight" style={{ fontSize: 8.5, background: extColor, color: '#fff' }}>
            {extLabel}
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-medium truncate leading-tight" style={{ color: 'var(--text)' }}>{item.file.fileName}</p>
        <p className="text-[11.5px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>{formatFileSize(item.file.sizeBytes)}</p>
      </div>
      <a
        href={url ?? '#'}
        download={url ? item.file.fileName : undefined}
        title="Download"
        onClick={(e) => { e.stopPropagation(); if (!url) e.preventDefault(); }}
        className="flex-shrink-0 p-1 rounded-md transition-colors"
        style={{ color: 'var(--text-dim)' }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </a>
    </div>
  );
}

function VoiceItem({ item, ui }: { item: ConversationAttachmentItem; ui: ItemInteraction }) {
  const url = useFileBlobUrl(item.file.id, 'original');
  const date = new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div
      {...interactionProps(ui)}
      className="flex items-center gap-3 p-2.5 rounded-xl transition-colors hover-panel-alt cursor-pointer"
      style={ui.selected ? { background: 'var(--accent-wash)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' } : undefined}
    >
      <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, background: 'var(--accent-wash)' }}>
        <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {/* Seeking and play/pause must not also jump the thread. */}
        <div onClick={(e) => e.stopPropagation()}>
          <VoicePlayer url={url} isMine={false} fileName={item.file.fileName} durationSecs={item.file.durationSecs ?? null} />
        </div>
        <p className="text-[11.5px] font-mono" style={{ color: 'var(--text-dim)' }}>{date}</p>
      </div>
    </div>
  );
}
