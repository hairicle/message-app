'use client';

import { useEffect, useState, type FormEvent } from 'react';
import * as conversationsApi from '../lib/api/conversations';
import { ApiError } from '../lib/api/client';
import type { Conversation, DirectoryUser } from '@messenger/shared';

interface NewConversationDialogProps {
  onCreated: (conversation: Conversation) => void;
}

type Mode = 'direct' | 'group';

export function NewConversationDialog({ onCreated }: NewConversationDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('direct');
  const [users, setUsers] = useState<DirectoryUser[]>([]);
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

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New Conversation
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
              <h2 className="font-semibold text-slate-900">Start a conversation</h2>
              <button
                onClick={close}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-3 bg-slate-50 border-b border-slate-100 flex-shrink-0">
              <button
                type="button"
                onClick={() => setMode('direct')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-colors ${
                  mode === 'direct'
                    ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Direct message
              </button>
              <button
                type="button"
                onClick={() => setMode('group')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-colors ${
                  mode === 'group'
                    ? 'bg-white text-indigo-600 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Group chat
              </button>
            </div>

            {error && (
              <p className="mx-4 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex-shrink-0">
                {error}
              </p>
            )}

            {/* Direct message list */}
            {mode === 'direct' && (
              <ul className="overflow-y-auto flex-1 p-2">
                {users.map((user) => (
                  <li key={user.id}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left transition-colors disabled:opacity-50"
                      onClick={() => startDirectConversation(user.id)}
                      disabled={creatingId === user.id}
                    >
                      <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                        {user.display_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-slate-800 truncate">
                          {user.display_name}
                        </span>
                        <span className="text-xs text-slate-400 truncate">@{user.username}</span>
                      </span>
                      {creatingId === user.id && (
                        <span className="ml-auto text-xs text-slate-400">Starting...</span>
                      )}
                    </button>
                  </li>
                ))}
                {users.length === 0 && !error && (
                  <li className="text-center py-8 text-sm text-slate-400">No other users found.</li>
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
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
                <ul className="overflow-y-auto flex-1 p-2">
                  {users.map((user) => (
                    <li key={user.id}>
                      <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(user.id)}
                          onChange={() => toggleSelected(user.id)}
                          className="w-4 h-4 rounded accent-indigo-600"
                        />
                        <span className="w-9 h-9 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold flex-shrink-0">
                          {user.display_name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {user.display_name}
                          </span>
                          <span className="text-xs text-slate-400 truncate">@{user.username}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                  {users.length === 0 && !error && (
                    <li className="text-center py-8 text-sm text-slate-400">No other users found.</li>
                  )}
                </ul>
                <div className="p-4 border-t border-slate-100 flex-shrink-0">
                  <button
                    type="submit"
                    disabled={!groupName.trim() || selectedIds.size === 0 || creatingGroup}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors"
                  >
                    {creatingGroup
                      ? 'Creating...'
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
