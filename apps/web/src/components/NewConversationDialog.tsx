'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import { ApiError } from '../lib/api/client';
import type { Conversation, DirectoryUser } from '@messenger/shared';
import { Avatar, SearchInput } from './ui';

interface NewConversationDialogProps {
  onCreated: (conversation: Conversation) => void;
}

type Mode = 'direct' | 'group';
/** Which half of the group flow is on screen. Direct messages are a single step and ignore this. */
type Step = 'members' | 'name';

/**
 * The smallest group worth calling one — you plus two others.
 *
 * Two people in a group is a direct message with extra steps, and a worse one: direct conversations
 * are deduplicated by their pair, groups are not, so the same two people end up with one of each
 * and half the history in either. Enforced for real in apps/api's ConversationsService; repeated
 * here only so the button can say why it is disabled instead of the server rejecting a submission.
 */
const MIN_GROUP_MEMBERS = 3;

export function NewConversationDialog({ onCreated }: NewConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('direct');
  const [step, setStep] = useState<Step>('members');
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    conversationsApi
      .listDirectory()
      .then(({ users }) => setUsers(users))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load directory'));
  }, [open]);

  // The name field is the only thing on the second step, so focusing it saves a click and makes
  // Enter submit without the pointer ever moving to the button.
  useEffect(() => {
    if (mode === 'group' && step === 'name') nameInputRef.current?.focus();
  }, [mode, step]);

  function close() {
    setOpen(false);
    setMode('direct');
    setStep('members');
    setError(null);
    setSearch('');
    setGroupName('');
    setSelectedIds(new Set());
  }

  /** Switching tabs starts that flow over; a half-picked group should not survive a detour. */
  function switchMode(next: Mode) {
    setMode(next);
    setStep('members');
    setError(null);
    setSearch('');
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
    if (!groupName.trim() || selectedIds.size + 1 < MIN_GROUP_MEMBERS) return;
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

  // Drawn from `users` rather than kept alongside the ids, so a chip cannot outlive the directory
  // row it names. Filtering the list keeps them in the directory's order rather than click order,
  // which stops the row jumping about as people are added and removed.
  const selectedUsers = users.filter((u) => selectedIds.has(u.id));
  const namingGroup = mode === 'group' && step === 'name';
  const enoughForGroup = selectedIds.size + 1 >= MIN_GROUP_MEMBERS;

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
            <div className="flex items-center gap-2 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              {namingGroup && (
                <button
                  type="button"
                  onClick={() => { setStep('members'); setError(null); }}
                  className="btn-icon flex-shrink-0"
                  style={{ width: 30, height: 30, marginLeft: -8 }}
                  aria-label="Back to choosing people"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <h2 className="text-[16px] font-bold tracking-tight mr-auto" style={{ color: 'var(--text)' }}>
                {namingGroup ? 'Name the group' : 'Start a conversation'}
              </h2>
              <button onClick={close} className="btn-icon flex-shrink-0" style={{ width: 30, height: 30 }} aria-label="Close">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs — matches ProfilePanel/AdminDashboard tab pattern. Hidden once the group's
                members are chosen: at that point the back arrow is the way out, and leaving the
                tabs up invites a click that would silently discard the selection. */}
            {!namingGroup && (
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
                      onClick={() => switchMode(t.id)}
                      className="flex-1 py-2.5 px-3 font-mono text-[13px] font-medium border-b-2 transition-colors"
                      style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-dim)', marginBottom: '-1px' }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}

            {error && (
              <p className="mx-4 mt-3 px-3 py-2 rounded-lg text-[12.5px] font-mono flex-shrink-0"
                style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            {!namingGroup && (
              <div className="px-4 pt-3 flex-shrink-0">
                <SearchInput value={search} onChange={setSearch} placeholder="Find a person…" />
              </div>
            )}

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

            {/* Group, step 1 — choose who is in it. Naming comes after, the way Telegram does it:
                the name you want usually depends on who ended up in the room, and being asked for
                it first means typing a placeholder and never correcting it. */}
            {mode === 'group' && step === 'members' && (
              <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
                {selectedUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-4 pt-3 flex-shrink-0">
                    {selectedUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleSelected(user.id)}
                        className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full transition-colors"
                        style={{ background: 'var(--accent-wash)', color: 'var(--accent)' }}
                        aria-label={`Remove ${user.display_name}`}
                      >
                        <Avatar name={user.display_name} avatarUrl={user.avatar_url} size={20} radius={10} fontSize={9} />
                        <span className="text-[12.5px] font-medium max-w-[120px] truncate">{user.display_name}</span>
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
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
                  {/* Says what is missing rather than only greying out — a disabled button with no
                      reason beside it reads as broken. */}
                  {!enoughForGroup && (
                    <p className="mb-2 text-center font-mono text-[11.5px]" style={{ color: 'var(--text-dim)' }}>
                      Pick {MIN_GROUP_MEMBERS - 1 - selectedIds.size} more
                      {selectedIds.size === 0 ? ` — a group needs ${MIN_GROUP_MEMBERS} people including you` : ''}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setStep('name')}
                    disabled={!enoughForGroup}
                    className="btn-primary w-full justify-center disabled:opacity-40"
                  >
                    Next{selectedIds.size ? ` · ${selectedIds.size + 1} members` : ''}
                  </button>
                </div>
              </div>
            )}

            {/* Group, step 2 — name it. */}
            {namingGroup && (
              <form className="flex flex-col min-h-0 flex-1 overflow-hidden" onSubmit={createGroup}>
                <div className="px-4 pt-4 pb-2 flex-shrink-0">
                  <input
                    ref={nameInputRef}
                    placeholder="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    maxLength={80}
                    className="input-base w-full"
                  />
                </div>
                <p className="px-4 pb-1 font-mono text-[11.5px] flex-shrink-0" style={{ color: 'var(--text-dim)' }}>
                  {selectedIds.size + 1} members
                </p>
                {/* Who is in it, still removable. Dropping to two people sends you back a step
                    rather than failing at the button, so the rule is never a dead end. */}
                <ul className="overflow-y-auto flex-1 p-2">
                  {selectedUsers.map((user) => (
                    <li key={user.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover-panel-alt">
                      <Avatar name={user.display_name} avatarUrl={user.avatar_url} size={36} radius={8} fontSize={14} />
                      <span className="flex flex-col min-w-0">
                        <span className="text-[14px] font-medium truncate" style={{ color: 'var(--text)' }}>
                          {user.display_name}
                        </span>
                        <span className="font-mono text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>@{user.username}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          toggleSelected(user.id);
                          // One fewer person leaves `selectedIds.size` in the room, counting you.
                          if (selectedIds.size < MIN_GROUP_MEMBERS) setStep('members');
                        }}
                        className="btn-icon ml-auto flex-shrink-0"
                        style={{ width: 28, height: 28 }}
                        aria-label={`Remove ${user.display_name}`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="p-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
                  <button type="submit" disabled={!groupName.trim() || !enoughForGroup || creatingGroup} className="btn-primary w-full justify-center disabled:opacity-40">
                    {creatingGroup ? 'Creating…' : `Create group · ${selectedIds.size + 1} members`}
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
