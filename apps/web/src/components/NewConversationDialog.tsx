'use client';

import { useEffect, useState, type FormEvent } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import { ApiError } from '../lib/api/client';
import type { Conversation, DirectoryUser } from '@messenger/shared';
import { Avatar, SearchInput } from './ui';

interface NewConversationDialogProps {
  onCreated: (conversation: Conversation) => void;
}

type Mode = 'direct' | 'group';

export function NewConversationDialog({ onCreated }: NewConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('direct');
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);

  useEffect(() => {
    if (!open) return;
    conversationsApi
      .listDirectory()
      .then(({ users }) => setUsers(users))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load directory'));
  }, [open]);

  function close() {
    setOpen(false);
    setMode('direct');
    setError(null);
    setSearch('');
    setGroupName('');
    setSelectedIds(new Set());
  }

  async function startDirectConversation(userId: string) {
    setError(null);
    setCreatingId(userId);
    try {
      const { conversation } = await conversationsApi.createConversation({
        type: 'direct',
        memberIds: [userId],
      });
      onCreated(conversation);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start conversation');
    } finally {
      setCreatingId(null);
    }
  }

  function toggleSelected(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim() || selectedIds.size === 0) return;
    setError(null);
    setCreatingGroup(true);
    try {
      const { conversation } = await conversationsApi.createConversation({
        type: 'group',
        name: groupName.trim(),
        memberIds: [...selectedIds],
      });
      onCreated(conversation);
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create group');
    } finally {
      setCreatingGroup(false);
    }
  }

  const filteredUsers = users.filter((u) =>
    !search ||
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      {/* Trigger button */}
      <button onClick={() => setOpen(true)} className="btn-primary w-full justify-center">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Conversation
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={close}
        >
          <div
            className="w-full max-w-md flex flex-col max-h-[80vh] overflow-hidden rounded-2xl"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-[16px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Start a conversation</h2>
              <button onClick={close} className="btn-icon" style={{ width: 30, height: 30 }} aria-label="Close">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs — matches ProfilePanel/AdminDashboard tab pattern */}
            <div className="flex px-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              {([
                { id: 'direct' as const, label: 'Direct message' },
                { id: 'group' as const, label: 'Group chat' },
              ]).map((t) => {
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMode(t.id)}
                    className="flex-1 py-2.5 px-3 font-mono text-[13px] font-medium border-b-2 transition-colors"
                    style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-dim)', marginBottom: '-1px' }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {error && (
              <p className="mx-4 mt-3 px-3 py-2 rounded-lg text-[12.5px] font-mono flex-shrink-0"
                style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            <div className="px-4 pt-3 flex-shrink-0">
              <SearchInput value={search} onChange={setSearch} placeholder="Find a person…" />
            </div>

            {/* Direct message list */}
            {mode === 'direct' && (
              <ul className="overflow-y-auto flex-1 p-2">
                {filteredUsers.map((user) => (
                  <li key={user.id}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors hover-panel-alt disabled:opacity-50"
                      onClick={() => startDirectConversation(user.id)}
                      disabled={creatingId === user.id}
                    >
                      <Avatar name={user.display_name} avatarUrl={user.avatar_url} size={36} radius={8} fontSize={14} />
                      <span className="flex flex-col min-w-0">
                        <span className="text-[14px] font-medium truncate" style={{ color: 'var(--text)' }}>
                          {user.display_name}
                        </span>
                        <span className="font-mono text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>@{user.username}</span>
                      </span>
                      {creatingId === user.id && (
                        <span className="ml-auto font-mono text-[11.5px]" style={{ color: 'var(--text-dim)' }}>Starting…</span>
                      )}
                    </button>
                  </li>
                ))}
                {filteredUsers.length === 0 && !error && (
                  <li className="text-center py-8 text-[13px]" style={{ color: 'var(--text-dim)' }}>
                    {search ? 'No matches found' : 'No other users found.'}
                  </li>
                )}
              </ul>
            )}

            {/* Group chat form */}
            {mode === 'group' && (
              <form className="flex flex-col min-h-0 flex-1 overflow-hidden" onSubmit={createGroup}>
                <div className="px-4 pt-3 pb-2 flex-shrink-0">
                  <input
                    placeholder="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="input-base w-full"
                  />
                </div>
                <ul className="overflow-y-auto flex-1 p-2">
                  {filteredUsers.map((user) => (
                    <li key={user.id}>
                      <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors hover-panel-alt">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleSelected(user.id)}
                          className="w-4 h-4 rounded flex-shrink-0"
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <Avatar name={user.display_name} avatarUrl={user.avatar_url} size={36} radius={8} fontSize={14} />
                        <span className="flex flex-col min-w-0">
                          <span className="text-[14px] font-medium truncate" style={{ color: 'var(--text)' }}>
                            {user.display_name}
                          </span>
                          <span className="font-mono text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>@{user.username}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {filteredUsers.length === 0 && !error && (
                    <li className="text-center py-8 text-[13px]" style={{ color: 'var(--text-dim)' }}>
                      {search ? 'No matches found' : 'No other users found.'}
                    </li>
                  )}
                </ul>
                <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
                  <button type="submit" disabled={!groupName.trim() || selectedIds.size === 0 || creatingGroup} className="btn-primary w-full justify-center disabled:opacity-40">
                    {creatingGroup
                      ? 'Creating…'
                      : `Create group${selectedIds.size ? ` (${selectedIds.size + 1} members)` : ''}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
