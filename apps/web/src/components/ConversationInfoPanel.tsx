'use client';

import { useEffect, useState } from 'react';
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
import { Avatar, Badge } from './ui';
import { fileTypeMeta } from './MessageAttachment';

export type InfoTab = 'media' | 'files' | 'voice';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  presence: Record<string, 'online' | 'offline'>;
  onClose: () => void;
  onOpenLightbox: (file: FileMeta, type: MessageType) => void;
  initialTab?: InfoTab;
}

export function ConversationInfoPanel({
  conversation,
  currentUserId,
  presence,
  onClose,
  onOpenLightbox,
  initialTab = 'media',
}: Props) {
  const [activeTab, setActiveTab] = useState<InfoTab>(initialTab);
  const [media, setMedia] = useState<ConversationMediaItem[] | null>(null);
  const [files, setFiles] = useState<ConversationAttachmentItem[] | null>(null);
  const [voice, setVoice] = useState<ConversationAttachmentItem[] | null>(null);

  const title = getConversationTitle(conversation, currentUserId);
  const other = conversation.type === 'direct' ? getOtherMember(conversation, currentUserId) : null;
  const isOnline = other ? presence[other.user_id] === 'online' : false;
  const isGroup = conversation.type !== 'direct';
  const members = conversation.members ?? [];

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
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg)', fontFamily: "'Inter', system-ui, sans-serif" }}>
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
          <Avatar name={title} avatarUrl={other?.avatar_url} size={72} radius={18} fontSize={26} className="mb-3" />
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
                    showPresence={m.user_id !== currentUserId} online={presence[m.user_id] === 'online'} />
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
                onClick={() => setActiveTab(id)}
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
            <div className="grid grid-cols-3 gap-px" style={{ background: 'var(--border)' }}>
              {media.map((item) => (
                <MediaThumb key={item.file.id} item={item} onOpen={onOpenLightbox} />
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
                <FileItem key={item.file.id} item={item} />
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
                <VoiceItem key={item.file.id} item={item} />
              ))}
            </div>
          )
        )}
      </div>
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
}: {
  item: ConversationMediaItem;
  onOpen: (file: FileMeta, type: MessageType) => void;
}) {
  const variant = item.type === 'image' && item.file.hasThumbnail ? 'thumbnail' : 'original';
  const url = useFileBlobUrl(item.file.id, variant);

  return (
    <button
      type="button"
      onClick={() => onOpen(item.file, item.type as MessageType)}
      className="relative aspect-square overflow-hidden hover:opacity-80 transition-opacity"
      style={{ background: 'var(--panel-alt)' }}
    >
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
    </button>
  );
}

function FileItem({ item }: { item: ConversationAttachmentItem }) {
  const url = useFileBlobUrl(item.file.id, 'original');
  const { label: extLabel, color: extColor } = fileTypeMeta(item.file.fileName);

  return (
    <a
      href={url ?? '#'}
      download={url ? item.file.fileName : undefined}
      onClick={(e) => { if (!url) e.preventDefault(); }}
      className="flex items-center gap-3 p-2.5 rounded-xl transition-colors group hover-panel-alt"
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
      <svg className="w-4 h-4 flex-shrink-0 transition-colors" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </a>
  );
}

function VoiceItem({ item }: { item: ConversationAttachmentItem }) {
  const url = useFileBlobUrl(item.file.id, 'original');
  const date = new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl transition-colors hover-panel-alt">
      <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, background: 'var(--accent-wash)' }}>
        <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {url ? (
          <audio src={url} controls className="w-full h-8 max-w-full" />
        ) : (
          <div className="h-8 rounded-full animate-pulse" style={{ background: 'var(--panel-alt)' }} />
        )}
        <p className="text-[11.5px] font-mono mt-1" style={{ color: 'var(--text-dim)' }}>{date}</p>
      </div>
    </div>
  );
}
