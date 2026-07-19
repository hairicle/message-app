'use client';

import { useEffect, useRef, useState } from 'react';
import * as departmentsApi from '../lib/api/departments';
import * as profileApi from '../lib/api/profile';
import type { UserProfile } from '@messenger/shared';
import { useAuth } from '../context/AuthContext';

const AVATAR_HEX = [
  '#6366f1','#a855f7','#ec4899','#ef4444','#f97316',
  '#273c8d','#3d52a8','#1a2d6b','#4a6fa8','#2d4a9e',
];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_HEX[Math.abs(h) % AVATAR_HEX.length];
}

type Tab = 'profile' | 'security' | 'notifications';

interface ProfilePanelProps { onClose: () => void; }

export function ProfilePanel({ onClose }: ProfilePanelProps) {
  const { user, updateUser } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  // Direct avatar URL state — set once we know there's a real photo to show
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [totpQr, setTotpQr] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpMsg, setTotpMsg] = useState('');

  const [prefs, setPrefs] = useState({ soundEnabled: true, desktopEnabled: true, emailEnabled: false });
  const [prefsMsg, setPrefsMsg] = useState('');

  useEffect(() => {
    profileApi.getMyProfile()
      .then(({ profile }) => {
        setProfile(profile);
        setDisplayName(profile.displayName);
        setDepartment(profile.department ?? '');
        setLoadError('');
        if (profile.avatarUrl) {
          setAvatarUrl(`${profileApi.getAvatarUrl(profile.id)}?v=${Date.now()}`);
        }
      })
      .catch((err: Error) => setLoadError(err.message));
    profileApi.getNotificationPrefs().then(({ prefs }) => setPrefs(prefs)).catch(() => {});
    departmentsApi.listDepartments().then(({ departments }) => setDepartments(departments)).catch(() => {});
  }, []);

  async function handleSaveProfile(e: { preventDefault(): void }) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const { profile: updated } = await profileApi.updateProfile({
        displayName: displayName.trim() || undefined,
        department: department.trim() || null,
      });
      setProfile(updated);
      updateUser({ displayName: updated.displayName });
      setSaveMsg('Saved!');
    } catch (err) { setSaveMsg((err as Error).message); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(''), 3000); }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError('');
    // Show local preview immediately — no server round-trip needed for display
    const localPreview = URL.createObjectURL(file);
    setAvatarUrl(localPreview);
    try {
      const { profile: updated } = await profileApi.uploadAvatar(file);
      const serverSrc = `${profileApi.getAvatarUrl(updated.id)}?v=${Date.now()}`;
      setProfile(updated);
      setAvatarUrl(serverSrc);
      updateUser({ avatarUrl: serverSrc });
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setAvatarUrl(null); // revert preview on error
      setAvatarError((err as Error).message || 'Upload failed');
    } finally {
      setAvatarUploading(false);
      URL.revokeObjectURL(localPreview);
    }
  }

  async function handleChangePassword(e: { preventDefault(): void }) {
    e.preventDefault(); setPwMsg('');
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match'); return; }
    if (newPw.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    try {
      await profileApi.changePassword(currentPw, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg('Password changed!');
    } catch (err) { setPwMsg((err as Error).message); }
    finally { setTimeout(() => setPwMsg(''), 4000); }
  }

  async function handleSetupTotp() {
    try {
      const res = await profileApi.setupTotp();
      setTotpQr(res.qrCodeDataUrl); setTotpSecret(res.secret);
      setTotpMsg('Scan the QR code in your authenticator app, then enter the 6-digit code.');
    } catch (err) { setTotpMsg((err as Error).message); }
  }

  async function handleEnableTotp(e: { preventDefault(): void }) {
    e.preventDefault();
    try {
      await profileApi.enableTotp(totpCode);
      setTotpEnabled(true); setTotpQr(''); setTotpSecret(''); setTotpCode('');
      setTotpMsg('2FA enabled!');
    } catch (err) { setTotpMsg((err as Error).message); }
    finally { setTimeout(() => setTotpMsg(''), 4000); }
  }

  async function handleDisableTotp(e: { preventDefault(): void }) {
    e.preventDefault();
    try {
      await profileApi.disableTotp(totpCode);
      setTotpEnabled(false); setTotpCode('');
      setTotpMsg('2FA disabled.');
    } catch (err) { setTotpMsg((err as Error).message); }
    finally { setTimeout(() => setTotpMsg(''), 4000); }
  }

  async function handleTogglePref(key: keyof typeof prefs) {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    try {
      await profileApi.updateNotificationPrefs(updated);
      setPrefsMsg('Saved');
    } catch (err) { setPrefs(prefs); setPrefsMsg((err as Error).message); }
    finally { setTimeout(() => setPrefsMsg(''), 2000); }
  }

  // avatarUrl state is set on load and after upload — single source of truth for display

  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'security', label: 'Security' },
    { id: 'notifications', label: 'Notifications' },
  ];

  return (
    <div className="absolute inset-0 z-50 flex" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Backdrop */}
      <div className="flex-1" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />

      {/* Panel */}
      <div className="w-[340px] flex flex-col h-full overflow-hidden shadow-2xl" style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}>

        {/* ── Header strip ── */}
        <div className="flex-shrink-0 px-5 pt-6 pb-5 relative" style={{ background: 'var(--panel-alt)', borderBottom: '1px solid var(--border)' }}>
          <button onClick={onClose}
            className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Avatar — full clickable zone */}
          <div className="flex items-center gap-4">
            {/* Avatar with transparent file input overlay — no JS .click() needed */}
            <div
              className="group relative flex-shrink-0 overflow-hidden"
              style={{ width: 64, height: 64, borderRadius: 12, border: '2px solid var(--border)' }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} className="w-full h-full object-cover"
                  onError={(e) => { console.error('Avatar img failed to load:', avatarUrl); (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }} />
              ) : (
                <div style={{ width: '100%', height: '100%', background: avatarColor(user?.username ?? 'u'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700, fontFamily: 'monospace' }}>
                  {(profile?.displayName ?? user?.displayName ?? '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              {/* Hover overlay (pointer-events: none so input below receives clicks) */}
              <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.6)', pointerEvents: 'none' }}>
                {avatarUploading ? (
                  <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-white mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-white text-[9px] font-mono">Change</span>
                  </>
                )}
              </div>
              {/* Transparent file input sits on top — user clicks it directly */}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                disabled={avatarUploading}
                onChange={handleAvatarChange}
                title="Click to change photo"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: avatarUploading ? 'wait' : 'pointer',
                }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold truncate" style={{ color: 'var(--text)' }}>
                {profile?.displayName ?? user?.displayName}
              </p>
              <p className="font-mono text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>
                @{profile?.username ?? user?.username}
              </p>
              {profile?.department && (
                <p className="text-[12px] truncate" style={{ color: 'var(--text-dim)' }}>{profile.department}</p>
              )}
              {profile?.role && (
                <span className="inline-block mt-1 font-mono text-[10px] uppercase tracking-wide px-2 py-0.5 rounded"
                  style={profile.role === 'admin'
                    ? { background: 'var(--warning-wash)', color: 'var(--warning)', border: '1px solid var(--warning-border)' }
                    : { background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}>
                  {profile.role}
                </span>
              )}
            </div>
          </div>

          {/* Avatar upload status */}
          {avatarUploading && (
            <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-dim)' }}>Uploading photo…</p>
          )}
          {avatarError && (
            <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--danger)' }}>Upload failed: {avatarError}</p>
          )}
          {!avatarUploading && !avatarError && (
            <span className="mt-2 font-mono text-[11px]" style={{ color: 'var(--accent)' }}>
              Click photo to change
            </span>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-3 text-[12px] font-mono font-semibold transition-colors border-b-2"
              style={{
                borderColor: tab === t.id ? 'var(--accent)' : 'transparent',
                color: tab === t.id ? 'var(--accent)' : 'var(--text-dim)',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto p-5" style={{ background: 'var(--panel)' }}>

          {/* PROFILE */}
          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {loadError && (
                <div className="px-3 py-2 rounded-lg text-[12px]"
                  style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                  {loadError}
                </div>
              )}

              {/* Display Name */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Display Name</label>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full text-[13px] focus:outline-none"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }}
                  onFocus={(e) => (e.target.style.borderColor = 'var(--accent-dim)')}
                  onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
              </div>

              {/* Department */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>
                  Department
                  {user?.role !== 'admin' && (
                    <span className="ml-2 font-mono text-[10px] normal-case px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--panel-alt)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                      admin only
                    </span>
                  )}
                </label>
                {user?.role === 'admin' ? (
                  <>
                    <select value={department} onChange={(e) => setDepartment(e.target.value)}
                      className="w-full text-[13px] focus:outline-none"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }}>
                      <option value="">— No department —</option>
                      {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                    <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-dim)' }}>Changing department moves you to that team automatically.</p>
                  </>
                ) : (
                  <div className="text-[13px] px-3 py-2 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    {profile?.department ?? <span style={{ color: 'var(--text-dim)' }}>Not set</span>}
                  </div>
                )}
              </div>

              {/* Email — read-only */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Email</label>
                <div className="text-[13px] px-3 py-2 rounded-lg font-mono" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  {profile?.email ?? '—'}
                </div>
              </div>

              {/* Username — read-only */}
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-dim)' }}>Username</label>
                <div className="text-[13px] px-3 py-2 rounded-lg font-mono" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  @{profile?.username ?? '—'}
                </div>
              </div>

              {saveMsg && (
                <p className="text-[12px] text-center font-mono" style={{ color: saveMsg === 'Saved!' || saveMsg.includes('updated') ? 'var(--accent)' : 'var(--danger)' }}>
                  {saveMsg}
                </p>
              )}

              <button type="submit" disabled={saving}
                className="w-full font-mono font-semibold text-[13px] disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent)', color: '#fff', padding: '10px', borderRadius: 8, border: '1px solid var(--accent)' }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </form>
          )}

          {/* SECURITY */}
          {tab === 'security' && (
            <div className="space-y-6">
              {/* Change password */}
              <div>
                <h3 className="font-mono text-[12px] uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Change Password</h3>
                <form onSubmit={handleChangePassword} className="space-y-2.5">
                  {[
                    { val: currentPw, set: setCurrentPw, ph: 'Current password' },
                    { val: newPw, set: setNewPw, ph: 'New password (min 8 chars)' },
                    { val: confirmPw, set: setConfirmPw, ph: 'Confirm new password' },
                  ].map(({ val, set, ph }) => (
                    <input key={ph} type="password" value={val} onChange={(e) => set(e.target.value)}
                      placeholder={ph}
                      className="w-full text-[13px] focus:outline-none"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }}
                      onFocus={(e) => (e.target.style.borderColor = 'var(--accent-dim)')}
                      onBlur={(e) => (e.target.style.borderColor = 'var(--border)')} />
                  ))}
                  {pwMsg && (
                    <p className="text-[12px] font-mono" style={{ color: pwMsg === 'Password changed!' ? 'var(--accent)' : 'var(--danger)' }}>{pwMsg}</p>
                  )}
                  <button type="submit" className="w-full font-mono font-semibold text-[13px] transition-opacity hover:opacity-90"
                    style={{ background: 'var(--panel-alt)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px', borderRadius: 8 }}>
                    Update password
                  </button>
                </form>
              </div>

              {/* 2FA */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-mono text-[12px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Two-Factor Auth</h3>
                    <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>TOTP authenticator app</p>
                  </div>
                  <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded"
                    style={totpEnabled
                      ? { background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }
                      : { background: 'var(--panel-alt)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                    {totpEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {!totpEnabled && !totpQr && (
                  <button onClick={handleSetupTotp} className="w-full font-mono font-semibold text-[13px] transition-opacity hover:opacity-90"
                    style={{ background: 'var(--accent)', color: '#fff', padding: '9px', borderRadius: 8, border: '1px solid var(--accent)' }}>
                    Set up 2FA
                  </button>
                )}

                {totpQr && (
                  <div className="space-y-3">
                    <img src={totpQr} alt="QR Code" className="w-36 h-36 mx-auto rounded-lg" style={{ border: '1px solid var(--border)' }} />
                    <p className="text-[10px] text-center font-mono break-all" style={{ color: 'var(--text-dim)' }}>
                      Secret: <span style={{ color: 'var(--text)' }}>{totpSecret}</span>
                    </p>
                    <form onSubmit={handleEnableTotp} className="flex gap-2">
                      <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                        maxLength={6} placeholder="6-digit code"
                        className="flex-1 text-[13px] text-center tracking-widest focus:outline-none font-mono"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }} />
                      <button type="submit" className="px-3 font-mono font-semibold text-[12px]"
                        style={{ background: 'var(--accent)', color: '#fff', borderRadius: 8, border: '1px solid var(--accent)' }}>
                        Activate
                      </button>
                    </form>
                  </div>
                )}

                {totpEnabled && (
                  <form onSubmit={handleDisableTotp} className="flex gap-2">
                    <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                      maxLength={6} placeholder="Enter code to disable"
                      className="flex-1 text-[13px] text-center tracking-widest focus:outline-none font-mono"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }} />
                    <button type="submit" className="px-3 font-mono font-semibold text-[12px]"
                      style={{ background: 'var(--danger-wash)', color: 'var(--danger)', borderRadius: 8, border: '1px solid var(--danger-border)' }}>
                      Disable
                    </button>
                  </form>
                )}

                {totpMsg && (
                  <p className="text-[11px] mt-2 font-mono" style={{ color: totpMsg.includes('!') || totpMsg.includes('Scan') ? 'var(--accent)' : 'var(--text-dim)' }}>
                    {totpMsg}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* NOTIFICATIONS */}
          {tab === 'notifications' && (
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-wide mb-4" style={{ color: 'var(--text-dim)' }}>Notification preferences</p>

              {([
                { key: 'soundEnabled' as const, label: 'Sound', desc: 'Play a sound for new messages' },
                { key: 'desktopEnabled' as const, label: 'Desktop', desc: 'Browser/OS push notifications' },
                { key: 'emailEnabled' as const, label: 'Email', desc: 'Email for missed messages' },
              ]).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-lg"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{label}</p>
                    <p className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>{desc}</p>
                  </div>
                  <button onClick={() => handleTogglePref(key)}
                    className="relative flex-shrink-0 transition-colors"
                    style={{ width: 40, height: 22, borderRadius: 11, background: prefs[key] ? 'var(--accent)' : 'var(--border)' }}>
                    <span className="absolute top-1 transition-transform"
                      style={{ width: 14, height: 14, borderRadius: 7, background: '#fff', left: 4, transform: prefs[key] ? 'translateX(18px)' : 'translateX(0)' }} />
                  </button>
                </div>
              ))}

              {prefsMsg && <p className="text-[12px] text-center font-mono" style={{ color: 'var(--accent)' }}>{prefsMsg}</p>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        select option { background: var(--panel); color: var(--text); }
      `}</style>
    </div>
  );
}
