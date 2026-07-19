import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { API_URL, apiFetch, getAuthToken } from '../api/client';
import * as departmentsApi from '../api/departments';
import type { Department } from '../api/departments';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faChartLine, faUsers, faSitemap, faFileLines, faMagnifyingGlass, faPlus, faUpload, faDownload, faRotate, faPen, faTrash, faChevronRight, faPause, faPlay, faXmark, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';

type AdminTab = 'overview' | 'users' | 'departments' | 'logs';

interface Stats { totalUsers: number; activeUsers: number; totalMessages: number; messagesLast24h: number; totalConversations: number }
interface AdminUser { id: string; email: string; username: string; display_name: string; role: string; department: string | null; status: string; created_at: string }
interface AuditLog { id: string; action: string; userEmail: string | null; ipAddress: string | null; createdAt: string; metadata: Record<string, unknown> | null }


function StatusDot({ ok = true }: { ok?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[13px] tracking-wide" style={{ color: ok ? 'var(--accent)' : 'var(--danger)' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ok ? 'var(--accent)' : 'var(--danger)', boxShadow: `0 0 6px ${ok ? 'var(--accent)' : 'var(--danger)'}` }} />
      {ok ? 'ALL SYSTEMS NORMAL' : 'ATTENTION NEEDED'}
    </span>
  );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'warning' }) {
  const toneClass = {
    neutral: 'text-[var(--text-muted)] border-[var(--border)]',
    accent:  'text-[var(--accent)] border-[var(--accent-dim)] bg-[var(--accent-wash)]',
    danger:  'text-[var(--danger)] border-[var(--danger-border)] bg-[var(--danger-wash)]',
    warning: 'text-[var(--warning)] border-[var(--warning-border)] bg-[var(--warning-wash)]',
  }[tone];
  return (
    <span className={`font-mono text-[12px] uppercase tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${toneClass}`}>
      {children}
    </span>
  );
}

export function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>('overview');

  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', username: '', displayName: '', password: '', role: 'staff', department: '' });
  const [createMsg, setCreateMsg] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; failed: { row: number; email: string; error: string }[] } | null>(null);

  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editUserFields, setEditUserFields] = useState({ displayName: '', username: '', email: '', role: '', department: '' });
  const [editUserMsg, setEditUserMsg] = useState('');

  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDesc, setNewDeptDesc] = useState('');
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptMsg, setDeptMsg] = useState('');
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ deptName: string; userId: string }>({ deptName: '', userId: '' });

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logAction, setLogAction] = useState('');
  const [logTotal, setLogTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ stats: Stats }>('/api/admin/stats').then(({ stats }) => setStats(stats)).catch(() => {});
    departmentsApi.listDepartments().then(({ departments }) => setDepartments(departments)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'users' || tab === 'departments') loadUsers();
    if (tab === 'logs') loadLogs();
  }, [tab]);

  async function loadUsers() {
    const res = await apiFetch<{ users: AdminUser[] }>('/api/users');
    setUsers(res.users);
  }

  async function loadLogs() {
    const params = new URLSearchParams({ limit: '50' });
    if (logAction) params.set('action', logAction);
    const res = await apiFetch<{ logs: AuditLog[]; total: number }>(`/api/admin/audit-logs?${params}`);
    setLogs(res.logs);
    setLogTotal(res.total);
  }

  async function handleCreateUser(e: { preventDefault(): void }) {
    e.preventDefault();
    setCreateMsg('');
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newUser.email, username: newUser.username,
          displayName: newUser.displayName, password: newUser.password,
          role: newUser.role || 'staff',
          department: newUser.department || undefined,
        }),
      });
      setCreateMsg('User created!');
      setNewUser({ email: '', username: '', displayName: '', password: '', role: 'staff', department: '' });
      setShowCreateUser(false);
      loadUsers();
      apiFetch<{ stats: Stats }>('/api/admin/stats').then(({ stats }) => setStats(stats)).catch(() => {});
    } catch (err) { setCreateMsg((err as Error).message); }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['email', 'username', 'displayName', 'password', 'role', 'department'],
      ['alice@company.local', 'alice', 'Alice Smith', 'Password123!', 'staff', 'Sale Team'],
      ['bob@company.local', 'bob', 'Bob Jones', 'Password123!', 'staff', 'IT'],
    ]);
    ws['!cols'] = [{ wch: 28 }, { wch: 15 }, { wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'user-import-template.xlsx');
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_URL}/api/admin/users/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        body: fd,
      });
      const json = await res.json() as { created: number; failed: { row: number; email: string; error: string }[] };
      setImportResult(json);
      if (json.created > 0) await loadUsers();
    } catch (err) {
      setImportResult({ created: 0, failed: [{ row: 0, email: '', error: (err as Error).message }] });
    } finally {
      setImporting(false);
    }
  }

  function startEditUser(u: AdminUser) {
    setEditingUser(u);
    setEditUserFields({ displayName: u.display_name, username: u.username, email: u.email, role: u.role, department: u.department ?? '' });
    setEditUserMsg('');
  }

  async function handleSaveUser(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!editingUser) return;
    setEditUserMsg('');
    try {
      await apiFetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: editUserFields.displayName || undefined,
          username: editUserFields.username || undefined,
          email: editUserFields.email || undefined,
          role: editUserFields.role || undefined,
          department: editUserFields.department || null,
        }),
      });
      setEditUserMsg('Saved!');
      await loadUsers();
      setTimeout(() => { setEditingUser(null); setEditUserMsg(''); }, 800);
    } catch (err) {
      setEditUserMsg((err as Error).message);
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: string) {
    const next = currentStatus === 'active' ? 'disabled' : 'active';
    if (!window.confirm(next === 'disabled' ? 'Disable this user? They will not be able to log in.' : 'Re-enable this user?')) return;
    await apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    await loadUsers();
  }

  async function handleDeleteUser(userId: string, displayName: string) {
    if (!window.confirm(`Permanently delete "${displayName}"?\n\nThis cannot be undone.`)) return;
    await apiFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    apiFetch<{ stats: Stats }>('/api/admin/stats').then(({ stats }) => setStats(stats)).catch(() => {});
  }

  async function handleCreateDept(e: { preventDefault(): void }) {
    e.preventDefault();
    setDeptMsg('');
    try {
      const { department } = await departmentsApi.createDepartment(newDeptName, newDeptDesc || undefined);
      setDepartments((prev) => [...prev, department].sort((a, b) => a.name.localeCompare(b.name)));
      setNewDeptName(''); setNewDeptDesc('');
      setDeptMsg('Department added!');
    } catch (err) { setDeptMsg((err as Error).message); }
    setTimeout(() => setDeptMsg(''), 3000);
  }

  async function handleUpdateDept(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!editingDept) return;
    try {
      const { department } = await departmentsApi.updateDepartment(editingDept.id, { name: editingDept.name, description: editingDept.description });
      setDepartments((prev) => prev.map((d) => d.id === department.id ? department : d));
      setEditingDept(null);
      setDeptMsg('Updated!');
    } catch (err) { setDeptMsg((err as Error).message); }
    setTimeout(() => setDeptMsg(''), 3000);
  }

  async function handleAssignToDept(userId: string, deptName: string) {
    await apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ department: deptName }) });
    await loadUsers();
    setAssignTarget({ deptName: '', userId: '' });
  }

  async function handleRemoveFromDept(userId: string) {
    await apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ department: null }) });
    await loadUsers();
  }

  async function handleDeleteDept(id: string, name: string) {
    if (!window.confirm(`Delete department "${name}"?`)) return;
    try {
      await departmentsApi.deleteDepartment(id);
      setDepartments((prev) => prev.filter((d) => d.id !== id));
      setDeptMsg('Deleted.');
    } catch (err) { setDeptMsg((err as Error).message); }
    setTimeout(() => setDeptMsg(''), 3000);
  }

  const filteredUsers = users.filter((u) =>
    !userSearch ||
    u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.username.toLowerCase().includes(userSearch.toLowerCase()),
  );

  const tabs: { id: AdminTab; label: string; icon: IconDefinition; count?: number }[] = [
    { id: 'overview',    label: 'Overview',    icon: faChartLine },
    { id: 'users',       label: 'Users',       icon: faUsers, count: users.length || undefined },
    { id: 'departments', label: 'Departments', icon: faSitemap, count: departments.length || undefined },
    { id: 'logs',        label: 'Audit Logs',  icon: faFileLines },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden admin-root" style={rootFont}>
      {/* Header + tabs */}
      <div className="flex-shrink-0" style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
        <div className="px-8 pt-6 pb-0 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>Admin Dashboard</h1>
              <StatusDot ok />
            </div>
            <p className="text-[15px]" style={{ color: 'var(--text-muted)' }}>Manage users, departments, and platform settings</p>
          </div>
        </div>
        <div className="flex px-8 mt-5 gap-1">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-4 py-2.5 font-mono text-[14px] font-medium border-b-2 transition-colors"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--text)' : 'var(--text-muted)', marginBottom: '-1px' }}>
                <FontAwesomeIcon icon={t.icon} style={{ fontSize: 14 }} />
                {t.label}
                {t.count !== undefined && (
                  <span className="text-[10.5px] px-1.5 rounded-full" style={{ color: active ? 'var(--accent)' : 'var(--text-dim)', background: active ? 'var(--accent-wash)' : 'var(--panel-alt)' }}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8" style={{ background: 'var(--bg)' }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid gap-px rounded-lg overflow-hidden border" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', background: 'var(--border)', borderColor: 'var(--border)' }}>
              {stats ? ([
                { key: 'totalUsers'         as const, label: 'Total users',    accent: false },
                { key: 'activeUsers'        as const, label: 'Active users',   accent: true  },
                { key: 'totalMessages'      as const, label: 'Messages',       accent: false },
                { key: 'messagesLast24h'    as const, label: 'Messages · 24h', accent: false },
                { key: 'totalConversations' as const, label: 'Conversations',  accent: false },
              ]).map(({ key, label, accent }) => (
                <div key={key} style={{ background: 'var(--panel)', padding: '20px 20px 18px' }}>
                  <p className="font-mono text-[12.5px] uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>{label}</p>
                  <p className="font-mono text-[30px] font-bold leading-none" style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}>
                    {String((stats as unknown as Record<string, number>)[key] ?? 0).padStart(2, '0')}
                  </p>
                </div>
              )) : <p className="col-span-5 text-sm p-5" style={{ color: 'var(--text-dim)' }}>Loading…</p>}
            </div>

            <div className="rounded-lg p-5 border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <h3 className="font-mono text-[14px] uppercase tracking-wide mb-4" style={{ color: 'var(--text-muted)' }}>Quick actions</h3>
              <div className="flex flex-wrap gap-2.5">
                <button onClick={() => {
                  apiFetch<{ synced: number }>('/api/admin/sync-department-teams', { method: 'POST' })
                    .then(({ synced }) => { window.alert(`Synced ${synced} users to department teams.`); apiFetch<{ stats: Stats }>('/api/admin/stats').then(({ stats }) => setStats(stats)).catch(() => {}); })
                    .catch((e) => window.alert((e as Error).message));
                }} className="btn-primary">
                  <FontAwesomeIcon icon={faRotate} style={{ fontSize: 13 }} /> Sync department teams
                </button>
                <button onClick={() => setTab('users')} className="btn-ghost"><FontAwesomeIcon icon={faUsers} style={{ fontSize: 13 }} /> Manage users</button>
                <button onClick={() => setTab('departments')} className="btn-ghost"><FontAwesomeIcon icon={faSitemap} style={{ fontSize: 13 }} /> Manage departments</button>
              </div>
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ fontSize: 13, color: 'var(--text-dim)' }} />
                <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name, email or username…"
                  className="input-base w-full pl-9" />
              </div>
              <button onClick={() => setShowCreateUser((v) => !v)} className="btn-primary"><FontAwesomeIcon icon={faPlus} style={{ fontSize: 13 }} /> New user</button>
              <button onClick={() => importInputRef.current?.click()} disabled={importing} className="btn-ghost disabled:opacity-50">
                <FontAwesomeIcon icon={faUpload} style={{ fontSize: 13 }} /> {importing ? 'Importing…' : 'Import Excel'}
              </button>
              <button onClick={downloadTemplate} className="btn-ghost"><FontAwesomeIcon icon={faDownload} style={{ fontSize: 13 }} /> Template</button>
              <button onClick={loadUsers} className="btn-icon" title="Refresh"><FontAwesomeIcon icon={faArrowsRotate} style={{ fontSize: 14 }} /></button>
              <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImportFile} />
            </div>

            {importResult && (
              <div className="rounded-lg p-4 border" style={{
                background: importResult.failed.length === 0 ? 'var(--accent-wash)' : 'var(--warning-wash)',
                borderColor: importResult.failed.length === 0 ? 'var(--accent-dim)' : 'var(--warning-border)',
              }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                    Import complete — <span style={{ color: 'var(--accent)' }}>{importResult.created} created</span>
                    {importResult.failed.length > 0 && <span style={{ color: 'var(--warning)', marginLeft: 8 }}>{importResult.failed.length} failed</span>}
                  </p>
                  <button onClick={() => setImportResult(null)} className="btn-icon" style={{ width: 22, height: 22 }}><FontAwesomeIcon icon={faXmark} style={{ fontSize: 12 }} /></button>
                </div>
                {importResult.failed.length > 0 && (
                  <ul className="space-y-1">
                    {importResult.failed.map((f, i) => (
                      <li key={i} className="text-[11.5px] font-mono" style={{ color: 'var(--warning)' }}>
                        Row {f.row}{f.email ? ` (${f.email})` : ''}: {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {showCreateUser && (
              <form onSubmit={handleCreateUser} className="rounded-lg p-6 border grid grid-cols-2 gap-4" style={{ background: 'var(--panel)', borderColor: 'var(--accent-dim)' }}>
                <h3 className="col-span-2 font-mono text-[13px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Create new user</h3>
                {([
                  { key: 'displayName' as const, label: 'Display name', placeholder: 'Alice Smith',         type: 'text'     },
                  { key: 'username'    as const, label: 'Username',     placeholder: 'alice',               type: 'text'     },
                  { key: 'email'       as const, label: 'Email',        placeholder: 'alice@company.local', type: 'email'    },
                  { key: 'password'    as const, label: 'Password',     placeholder: 'min 8 characters',    type: 'password' },
                ]).map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="block font-mono text-[12.5px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>{label}</label>
                    <input type={type ?? 'text'} value={(newUser as Record<string, string>)[key]}
                      onChange={(e) => setNewUser((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={placeholder} required className="input-base w-full" />
                  </div>
                ))}
                <div>
                  <label className="block font-mono text-[10.5px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Role</label>
                  <input value={newUser.role} onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                    placeholder="staff, admin, manager…" className="input-base w-full" />
                </div>
                <div>
                  <label className="block font-mono text-[10.5px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Department</label>
                  <select value={newUser.department} onChange={(e) => setNewUser((p) => ({ ...p, department: e.target.value }))} className="input-base w-full">
                    <option value="">— None —</option>
                    {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                {createMsg && <p className="col-span-2 text-sm text-center font-mono" style={{ color: createMsg.includes('!') ? 'var(--accent)' : 'var(--danger)' }}>{createMsg}</p>}
                <div className="col-span-2 flex gap-3">
                  <button type="submit" className="btn-primary flex-1 justify-center">Create user</button>
                  <button type="button" onClick={() => setShowCreateUser(false)} className="btn-ghost">Cancel</button>
                </div>
              </form>
            )}

            <div className="rounded-lg overflow-hidden border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--panel-alt)', borderBottom: '1px solid var(--border)' }}>
                    <th className="th-cell">User</th>
                    <th className="th-cell">Department</th>
                    <th className="th-cell">Role</th>
                    <th className="th-cell">Status</th>
                    <th className="th-cell">Joined</th>
                    <th className="th-cell"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <React.Fragment key={u.id}>
                      <tr className="row-hover transition-colors" style={{
                        borderBottom: '1px solid var(--border)',
                        borderLeft: `2px solid ${u.status === 'active' ? 'var(--accent)' : 'var(--danger)'}`,
                        background: editingUser?.id === u.id ? 'var(--accent-wash)' : 'transparent',
                      }}>
                        <td className="td-cell">
                          <div className="flex items-center gap-3">
                            <div className="avatar-box">{u.display_name.slice(0, 1).toUpperCase()}</div>
                            <div>
                              <p className="font-medium text-[15px]" style={{ color: 'var(--text)' }}>{u.display_name}</p>
                              <p className="font-mono text-[13px]" style={{ color: 'var(--text-dim)' }}>@{u.username} · {u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="td-cell text-[14px]" style={{ color: 'var(--text-muted)' }}>{u.department ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                        <td className="td-cell"><Badge tone={u.role === 'admin' ? 'warning' : 'neutral'}>{u.role}</Badge></td>
                        <td className="td-cell"><Badge tone={u.status === 'active' ? 'accent' : 'danger'}>{u.status}</Badge></td>
                        <td className="td-cell font-mono text-[13px]" style={{ color: 'var(--text-dim)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                        <td className="td-cell">
                          <div className="flex gap-1.5 justify-end items-center">
                            <button onClick={() => editingUser?.id === u.id ? setEditingUser(null) : startEditUser(u)} className="btn-icon" title="Edit">
                              {editingUser?.id === u.id ? <FontAwesomeIcon icon={faXmark} style={{ fontSize: 13 }} /> : <FontAwesomeIcon icon={faPen} style={{ fontSize: 13 }} />}
                            </button>
                            <button onClick={() => handleToggleStatus(u.id, u.status)} className="btn-icon" title={u.status === 'active' ? 'Disable' : 'Enable'}>
                              {u.status === 'active' ? <FontAwesomeIcon icon={faPause} style={{ fontSize: 13 }} /> : <FontAwesomeIcon icon={faPlay} style={{ fontSize: 13 }} />}
                            </button>
                            <button onClick={() => handleDeleteUser(u.id, u.display_name)} className="btn-icon" style={{ color: 'var(--danger)' }} title="Delete">
                              <FontAwesomeIcon icon={faTrash} style={{ fontSize: 13 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingUser?.id === u.id && (
                        <tr style={{ background: 'var(--accent-wash)' }}>
                          <td colSpan={6} className="px-5 py-4">
                            <form onSubmit={handleSaveUser}>
                              <div className="grid grid-cols-3 gap-3 mb-3">
                                {([
                                  { key: 'displayName' as const, label: 'Display name', type: 'text',  placeholder: ''                   },
                                  { key: 'username'    as const, label: 'Username',     type: 'text',  placeholder: ''                   },
                                  { key: 'email'       as const, label: 'Email',        type: 'email', placeholder: ''                   },
                                  { key: 'role'        as const, label: 'Role',         type: 'text',  placeholder: 'staff, admin, manager…' },
                                ]).map(({ key, label, type, placeholder }) => (
                                  <div key={key}>
                                    <label className="block font-mono text-[12.5px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>{label}</label>
                                    <input type={type ?? 'text'}
                                      value={(editUserFields as Record<string, string>)[key]}
                                      onChange={(e) => setEditUserFields((p) => ({ ...p, [key]: e.target.value }))}
                                      placeholder={placeholder}
                                      className="input-base w-full" />
                                  </div>
                                ))}
                                <div>
                                  <label className="block font-mono text-[12.5px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Department</label>
                                  <select value={editUserFields.department}
                                    onChange={(e) => setEditUserFields((p) => ({ ...p, department: e.target.value }))}
                                    className="input-base w-full">
                                    <option value="">— No department —</option>
                                    {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <button type="submit" className="btn-primary">Save changes</button>
                                <button type="button" onClick={() => setEditingUser(null)} className="btn-ghost">Cancel</button>
                                {editUserMsg && <span className="text-sm font-medium font-mono" style={{ color: editUserMsg === 'Saved!' ? 'var(--accent)' : 'var(--danger)' }}>{editUserMsg}</span>}
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No users found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DEPARTMENTS ── */}
        {tab === 'departments' && (
          <div className="space-y-4">
            {deptMsg && (
              <p className="text-sm font-medium text-center py-2 rounded-lg font-mono" style={{
                background: (deptMsg.includes('!') || deptMsg === 'Updated!' || deptMsg === 'Deleted.') ? 'var(--accent-wash)' : 'var(--danger-wash)',
                color: (deptMsg.includes('!') || deptMsg === 'Updated!' || deptMsg === 'Deleted.') ? 'var(--accent)' : 'var(--danger)',
              }}>{deptMsg}</p>
            )}
            <div className="rounded-lg p-5 border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
              <h3 className="font-mono text-[12px] uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Add department</h3>
              <form onSubmit={handleCreateDept} className="flex gap-3">
                <input value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} placeholder="Department name" required className="input-base flex-1" />
                <input value={newDeptDesc} onChange={(e) => setNewDeptDesc(e.target.value)} placeholder="Description (optional)" className="input-base flex-1" />
                <button type="submit" className="btn-primary"><FontAwesomeIcon icon={faPlus} style={{ fontSize: 13 }} /> Add</button>
              </form>
            </div>

            <div className="space-y-2.5">
              {departments.map((d) => {
                const members = users.filter((u) => u.department?.toLowerCase() === d.name.toLowerCase());
                const isExpanded = expandedDept === d.id;
                const unassigned = users.filter((u) => u.department?.toLowerCase() !== d.name.toLowerCase());
                return (
                  <div key={d.id} className="rounded-lg overflow-hidden border" style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-3 px-5 py-4">
                      <button onClick={() => setExpandedDept(isExpanded ? null : d.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <FontAwesomeIcon icon={faChevronRight} style={{ fontSize: 14, color: 'var(--text-dim)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
                        <div className="dept-icon">{d.name.slice(0, 1).toUpperCase()}</div>
                        <div className="min-w-0">
                          {editingDept?.id !== d.id && (
                            <>
                              <p className="font-semibold text-[16px]" style={{ color: 'var(--text)' }}>{d.name}</p>
                              {d.description && <p className="text-[12px]" style={{ color: 'var(--text-dim)' }}>{d.description}</p>}
                            </>
                          )}
                        </div>
                        <span className="ml-auto flex-shrink-0"><Badge tone="accent">{members.length} member{members.length !== 1 ? 's' : ''}</Badge></span>
                      </button>
                      <button onClick={() => setEditingDept(editingDept?.id === d.id ? null : d)} className="btn-icon" title="Edit"><FontAwesomeIcon icon={faPen} style={{ fontSize: 13 }} /></button>
                      <button onClick={() => handleDeleteDept(d.id, d.name)} className="btn-icon" style={{ color: 'var(--danger)' }} title="Delete"><FontAwesomeIcon icon={faTrash} style={{ fontSize: 13 }} /></button>
                    </div>
                    {editingDept?.id === d.id && (
                      <div className="px-5 pb-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                        <form onSubmit={handleUpdateDept} className="flex gap-2">
                          <input value={editingDept.name} onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })} className="input-base flex-1" style={{ borderColor: 'var(--accent-dim)' }} />
                          <input value={editingDept.description ?? ''} onChange={(e) => setEditingDept({ ...editingDept, description: e.target.value })} placeholder="Description" className="input-base flex-1" />
                          <button type="submit" className="btn-primary">Save</button>
                          <button type="button" onClick={() => setEditingDept(null)} className="btn-ghost">Cancel</button>
                        </form>
                      </div>
                    )}
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid var(--border)' }}>
                        {members.length > 0 ? (
                          <ul>
                            {members.map((u) => (
                              <li key={u.id} className="flex items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                                <div className="avatar-box" style={{ width: 26, height: 26 }}>{u.display_name.slice(0, 1).toUpperCase()}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[15px] font-medium truncate" style={{ color: 'var(--text)' }}>{u.display_name}</p>
                                  <p className="font-mono text-[13px]" style={{ color: 'var(--text-dim)' }}>@{u.username}</p>
                                </div>
                                <Badge tone={u.role === 'admin' ? 'warning' : 'neutral'}>{u.role}</Badge>
                                <Badge tone={u.status === 'active' ? 'accent' : 'danger'}>{u.status}</Badge>
                                <button onClick={() => handleRemoveFromDept(u.id)} title="Remove" className="btn-icon ml-1"><FontAwesomeIcon icon={faXmark} style={{ fontSize: 12 }} /></button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="px-5 py-4 text-sm italic" style={{ color: 'var(--text-dim)' }}>No members in this department</p>
                        )}
                        <div className="px-5 py-3 flex gap-2 items-center" style={{ background: 'var(--panel-alt)', borderTop: '1px solid var(--border)' }}>
                          <select value={assignTarget.deptName === d.name ? assignTarget.userId : ''} onChange={(e) => setAssignTarget({ deptName: d.name, userId: e.target.value })} className="input-base flex-1">
                            <option value="">— Assign a user to {d.name} —</option>
                            {unassigned.map((u) => <option key={u.id} value={u.id}>{u.display_name} (@{u.username}){u.department ? ` · currently in ${u.department}` : ''}</option>)}
                          </select>
                          <button disabled={!assignTarget.userId || assignTarget.deptName !== d.name} onClick={() => handleAssignToDept(assignTarget.userId, d.name)} className="btn-primary disabled:opacity-40">Assign</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {departments.length === 0 && (
                <div className="rounded-lg p-10 text-center text-sm border" style={{ background: 'var(--panel)', borderColor: 'var(--border)', color: 'var(--text-dim)' }}>No departments yet — add one above</div>
              )}
            </div>
          </div>
        )}

        {/* ── AUDIT LOGS ── */}
        {tab === 'logs' && (
          <div className="space-y-4">
            <div className="flex gap-3 items-center">
              <select value={logAction} onChange={(e) => setLogAction(e.target.value)} className="input-base" style={{ minWidth: 200 }}>
                <option value="">All actions</option>
                {['auth.login','auth.login_failed','auth.totp_enabled','auth.totp_disabled','auth.password_changed','users.created','messages.deleted'].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <button onClick={loadLogs} className="btn-primary">Filter</button>
              <span className="font-mono text-[13.5px] ml-auto" style={{ color: 'var(--text-dim)' }}>{logTotal} total entries</span>
            </div>
            <div className="rounded-lg overflow-hidden border font-mono" style={{ background: 'var(--bg-deep)', borderColor: 'var(--border)' }}>
              <div className="px-5 py-2 flex gap-2 items-center" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--warning)' }} />
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                <span className="text-[13px] ml-1.5" style={{ color: 'var(--text-dim)' }}>audit.log — tail</span>
              </div>
              {logs.map((l) => {
                const isFail = l.action.includes('failed');
                const isDelete = l.action.includes('deleted');
                return (
                  <div key={l.id} className="flex gap-4 px-5 py-2.5 text-[13.5px] flex-wrap" style={{ borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${isFail ? 'var(--danger)' : isDelete ? 'var(--warning)' : 'transparent'}` }}>
                    <span style={{ color: 'var(--text-dim)' }}>{new Date(l.createdAt).toLocaleString()}</span>
                    <span style={{ color: isFail ? 'var(--danger)' : isDelete ? 'var(--warning)' : 'var(--accent)' }}>{l.action}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{l.userEmail ?? '—'}</span>
                    <span style={{ color: 'var(--text-dim)' }}>{l.ipAddress ?? '—'}</span>
                    {l.metadata && <span style={{ color: 'var(--text-dim)', opacity: 0.7 }} className="truncate max-w-xs">{JSON.stringify(l.metadata)}</span>}
                  </div>
                );
              })}
              {logs.length === 0 && <p className="px-5 py-10 text-center text-sm" style={{ color: 'var(--text-dim)' }}>No logs found</p>}
            </div>
          </div>
        )}

      </div>

      <style>{`
        .admin-root { background: var(--bg); }
        .admin-root * { box-sizing: border-box; }
        .th-cell { text-align: left; padding: 12px 18px; font-size: 12.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; font-family: monospace; font-weight: 600; }
        .td-cell { padding: 14px 18px; }
        .avatar-box { width: 32px; height: 32px; border-radius: 7px; background: var(--panel-alt); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-family: monospace; font-size: 13px; font-weight: 700; color: var(--accent); flex-shrink: 0; }
        .dept-icon { width: 36px; height: 36px; border-radius: 8px; background: var(--accent-wash); border: 1px solid var(--accent-dim); display: flex; align-items: center; justify-content: center; font-family: monospace; font-weight: 700; font-size: 14px; color: var(--accent); flex-shrink: 0; }
        .row-hover:hover { background: var(--panel-alt) !important; }
        .input-base { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 14px; color: var(--text); outline: none; }
        .input-base:focus { border-color: var(--accent-dim); }
        .btn-primary { display: inline-flex; align-items: center; gap: 7px; font-family: monospace; font-size: 14px; font-weight: 500; padding: 9px 15px; border-radius: 8px; cursor: pointer; background: var(--accent); color: #ffffff; border: 1px solid var(--accent); transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.9; }
        .btn-ghost { display: inline-flex; align-items: center; gap: 7px; font-family: monospace; font-size: 14px; font-weight: 500; padding: 9px 15px; border-radius: 8px; cursor: pointer; background: transparent; color: var(--text-muted); border: 1px solid var(--border); transition: all 0.15s; }
        .btn-ghost:hover { color: var(--text); border-color: var(--text-dim); }
        .btn-icon { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--border); border-radius: 7px; color: var(--text-muted); cursor: pointer; transition: all 0.15s; }
        .btn-icon:hover { border-color: var(--text-dim); color: var(--text); }
      `}</style>
    </div>
  );
}

// CSS variables now come from index.css (:root and .dark)
// fontFamily only needed here as inline style
const rootFont: React.CSSProperties = { fontFamily: "'Inter', system-ui, sans-serif" };
