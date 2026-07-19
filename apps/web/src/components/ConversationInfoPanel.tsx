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

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200 flex-shrink-0">
        <h2 className="font-semibold text-slate-900 text-sm flex-1">Info</h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label="Close panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile section */}
        <div className="flex flex-col items-center px-6 py-6 border-b border-slate-100">
          <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-3xl font-bold mb-3 shadow-md">
            {title.slice(0, 1).toUpperCase()}
          </div>
          <h3 className="font-bold text-slate-900 text-base text-center leading-snug">{title}</h3>

          {other && (
            <span className={`text-xs mt-1.5 font-medium ${isOnline ? 'text-emerald-500' : 'text-slate-400'}`}>
              {isOnline ? '● Online' : '○ Offline'}
            </span>
          )}
          {other?.username && (
            <span className="text-xs text-slate-400 mt-0.5">@{other.username}</span>
          )}
          {isGroup && (
            <span className="text-xs mt-1.5 text-slate-400">{members.length} members</span>
          )}

          {/* Group member list */}
          {isGroup && members.length > 0 && (
            <div className="w-full mt-4 space-y-1.5">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2.5 py-0.5">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">
                    {m.display_name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate leading-tight">{m.display_name}</p>
                    <p className="text-xs text-slate-400 capitalize leading-tight">{m.role}</p>
                  </div>
                  {presence[m.user_id] === 'online' && m.user_id !== currentUserId && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 flex-shrink-0">
          {(['media', 'files', 'voice'] as InfoTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'media' && (
          media === null ? <TabLoading /> : media.length === 0 ? (
            <TabEmpty label="No media shared yet." />
          ) : (
            <div className="grid grid-cols-3 gap-px bg-slate-200">
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
    <div className="py-12 text-center text-sm text-slate-400">
      <div className="w-5 h-5 rounded-full border-2 border-slate-300 border-t-indigo-500 animate-spin mx-auto mb-2" />
      Loading...
    </div>
  );
}

function TabEmpty({ label }: { label: string }) {
  return <div className="py-12 text-center text-sm text-slate-400">{label}</div>;
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
      className="relative aspect-square bg-slate-100 overflow-hidden hover:opacity-80 transition-opacity"
    >
      {url && item.type === 'image' && (
        <img src={url} alt="" className="w-full h-full object-cover" />
      )}
      {url && item.type === 'video' && (
        <>
          <video src={url} preload="metadata" muted className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
              <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </>
      )}
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-transparent animate-spin" />
        </div>
      )}
    </button>
  );
}

function FileItem({ item }: { item: ConversationAttachmentItem }) {
  const url = useFileBlobUrl(item.file.id, 'original');

  return (
    <a
      href={url ?? '#'}
      download={url ? item.file.fileName : undefined}
      onClick={(e) => { if (!url) e.preventDefault(); }}
      className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
    >
      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate leading-tight">{item.file.fileName}</p>
        <p className="text-xs text-slate-400 mt-0.5">{formatFileSize(item.file.sizeBytes)}</p>
      </div>
      <svg
        className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
    </a>
  );
}

function VoiceItem({ item }: { item: ConversationAttachmentItem }) {
  const url = useFileBlobUrl(item.file.id, 'original');
  const date = new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
      <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {url ? (
          <audio src={url} controls className="w-full h-8 max-w-full" />
        ) : (
          <div className="h-8 bg-slate-100 rounded-full animate-pulse" />
        )}
        <p className="text-xs text-slate-400 mt-1">{date}</p>
      </div>
    </div>
  );
}
