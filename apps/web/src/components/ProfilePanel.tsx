'use client';

import { useEffect, useRef, useState } from 'react';
import * as profileApi from '../lib/api/profile';
import type { UserProfile } from '@messenger/shared';
import { useAuth } from '../context/AuthContext';
import { Badge } from './ui';
import { useConfirm } from './ConfirmDialog';

type Tab = 'profile' | 'security' | 'alerts';

interface ProfilePanelProps {
  onClose: () => void;
  onPrefsChange?: (prefs: { soundEnabled: boolean; desktopEnabled: boolean; emailEnabled: boolean }) => void;
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IconUser = () => (
  <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);
const IconLock = () => (
  <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  </svg>
);
const IconBell = () => (
  <svg className="w-[13px] h-[13px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);
const IconEye = ({ off }: { off?: boolean }) => off ? (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
) : (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

// ── Reusable field label ──────────────────────────────────────────────────────
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
      {children}
    </label>
  );
}

// ── Read-only display row ─────────────────────────────────────────────────────
function ReadonlyField({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] px-3 py-2.5 rounded-lg font-mono" style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
      {children}
    </div>
  );
}

// ── Styled text input ─────────────────────────────────────────────────────────
function TextInput({ value, onChange, placeholder, type = 'text', right }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; right?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-[13px] focus:outline-none transition-colors"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: right ? '9px 40px 9px 12px' : '9px 12px', color: 'var(--text)' }}
        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)'; }}
      />
      {right && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-dim)' }}>
          {right}
        </span>
      )}
    </div>
  );
}

export function ProfilePanel({ onClose, onPrefsChange }: ProfilePanelProps) {
  const { user, updateUser, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loadError, setLoadError] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');
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
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );
  const [testSent, setTestSent] = useState(false);

  // Show/hide toggles for password fields (styling addition)
  const [showPws, setShowPws] = useState({ current: false, next: false, confirm: false });

  // Avatar lightbox
  const [previewOpen, setPreviewOpen] = useState(false);

  const { confirm, confirmDialog } = useConfirm();

  async function handleSignOut() {
    const ok = await confirm({
      title: 'Sign out of your account?',
      description: 'You will need to enter your email and password again to get back in.',
      confirmLabel: 'Sign Out',
      cancelLabel: 'Stay Signed In',
    });
    if (!ok) return;
    onClose();
    logout();
  }

  useEffect(() => {
    profileApi.getMyProfile()
      .then(({ profile }) => {
        setProfile(profile);
        setDisplayName(profile.displayName);
        setLoadError('');
        if (profile.avatarUrl) {
          setAvatarUrl(`${profile.avatarUrl}?v=${Date.now()}`);
        }
      })
      .catch((err: Error) => setLoadError(err.message));
    profileApi.getNotificationPrefs().then(({ prefs }) => { setPrefs(prefs); onPrefsChange?.(prefs); }).catch(() => {});
  }, []);

  async function handleSaveProfile(e: { preventDefault(): void }) {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      const { profile: updated } = await profileApi.updateProfile({
        displayName: displayName.trim() || undefined,
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
    const localPreview = URL.createObjectURL(file);
    setAvatarUrl(localPreview);
    try {
      const { profile: updated } = await profileApi.uploadAvatar(file);
      const serverSrc = updated.avatarUrl ? `${updated.avatarUrl}?v=${Date.now()}` : null;
      setProfile(updated);
      setAvatarUrl(serverSrc);
      updateUser({ avatarUrl: serverSrc ?? undefined });
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setAvatarUrl(null);
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
    const turningOn = !prefs[key];
    const updated = { ...prefs, [key]: turningOn };
    setPrefs(updated);
    onPrefsChange?.(updated);

    // Turning Desktop on while permission hasn't been decided yet — ask right now, in this click's gesture
    if (key === 'desktopEnabled' && turningOn && notifPermission === 'default') {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    }

    try {
      await profileApi.updateNotificationPrefs(updated);
      setPrefsMsg('Saved');
    } catch (err) {
      setPrefs(prefs);
      onPrefsChange?.(prefs);
      setPrefsMsg((err as Error).message);
    }
    finally { setTimeout(() => setPrefsMsg(''), 2000); }
  }

  function handleSendTestNotification() {
    if (notifPermission !== 'granted') return;
    try {
      new Notification('Test notification', { body: 'Desktop notifications are working.' });
      setTestSent(true);
      setTimeout(() => setTestSent(false), 2500);
    } catch {
      setPrefsMsg('Could not show notification — check your OS notification settings');
      setTimeout(() => setPrefsMsg(''), 3000);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const pwFilled = currentPw.length > 0 && newPw.length > 0 && confirmPw.length > 0;
  const isSaved = saveMsg === 'Saved!';

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'profile',  label: 'Profile',  icon: <IconUser /> },
    { id: 'security', label: 'Security', icon: <IconLock /> },
    { id: 'alerts',   label: 'Alerts',   icon: <IconBell /> },
  ];

  const ALERT_ITEMS: {
    key: keyof typeof prefs;
    label: string;
    desc: string;
    icon: (on: boolean) => React.ReactNode;
  }[] = [
    {
      key: 'soundEnabled',
      label: 'Sound',
      desc: 'Play a sound for new messages',
      icon: (on) => (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: on ? 'var(--success)' : 'var(--text-dim)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536A4 4 0 108.464 14" />
        </svg>
      ),
    },
    {
      key: 'desktopEnabled',
      label: 'Desktop',
      desc: 'Browser push notifications when in background',
      icon: (on) => (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: on ? 'var(--success)' : 'var(--text-dim)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      key: 'emailEnabled',
      label: 'Email',
      desc: 'Email digest for missed messages',
      icon: (on) => (
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: on ? 'var(--success)' : 'var(--text-dim)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  const PW_FIELDS: { key: keyof typeof showPws; val: string; set: (v: string) => void; ph: string }[] = [
    { key: 'current', val: currentPw, set: setCurrentPw, ph: 'Current password' },
    { key: 'next',    val: newPw,     set: setNewPw,     ph: 'New password (min 8 chars)' },
    { key: 'confirm', val: confirmPw, set: setConfirmPw, ph: 'Confirm new password' },
  ];

  return (
    <div className="absolute inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1" style={{ background: 'rgba(0,0,0,0.48)' }} onClick={onClose} />

      {/* Slide-in panel */}
      <div className="w-full max-w-sm flex flex-col h-full overflow-hidden"
        style={{ background: 'var(--bg)', borderLeft: '1px solid var(--border)', fontFamily: "'Inter', system-ui, sans-serif" }}>

        {/* ── Avatar header ─────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-5 pt-5 pb-5" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>

          {/* Close button row */}
          <div className="flex justify-end mb-4">
            <button onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-dim)', border: '1px solid var(--border)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Hidden file input — outside overflow:hidden so clicks are never clipped */}
          <input
            ref={avatarInputRef}
            type="file" accept="image/*"
            disabled={avatarUploading}
            onChange={handleAvatarChange}
            className="hidden"
          />

          <div className="flex items-center gap-4">
            {/* Avatar square — click triggers file picker via ref */}
            <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
              <div className="group relative"
                style={{ width: 68, height: 68, borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--panel-alt)', cursor: avatarUploading ? 'wait' : 'pointer' }}
                onClick={() => { if (avatarUploading) return; avatarUrl ? setPreviewOpen(true) : avatarInputRef.current?.click(); }}>
                {/* Initials — always behind image */}
                <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold font-mono select-none" style={{ color: 'var(--accent)' }}>
                  {(profile?.displayName ?? user?.displayName ?? '?').slice(0, 1).toUpperCase()}
                </span>
                {/* Photo on top */}
                {avatarUrl && (
                  <img src={avatarUrl} alt="" className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                )}
                {/* Camera overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(0,0,0,0.52)' }}>
                  {avatarUploading ? (
                    <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </div>
              </div>
              {/* Explicit change-photo button */}
              <button type="button"
                disabled={avatarUploading}
                onClick={() => avatarInputRef.current?.click()}
                className="font-mono text-[10.5px] disabled:opacity-40 transition-colors"
                style={{ color: 'var(--accent)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'underline'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecoration = 'none'; }}>
                {avatarUploading ? 'Uploading…' : 'Change photo'}
              </button>
            </div>

            {/* Name / username / role */}
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold leading-tight truncate" style={{ color: 'var(--text)' }}>
                {profile?.displayName ?? user?.displayName}
              </p>
              <p className="font-mono text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>
                @{profile?.username ?? user?.username}
              </p>
              {profile?.department && (
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>
                  {profile.department}
                </p>
              )}
              {profile?.role && (
                <div className="mt-2">
                  <Badge tone={profile.role === 'admin' ? 'warning' : 'accent'}>{profile.role}</Badge>
                </div>
              )}
            </div>
          </div>

          {avatarError && (
            <p className="mt-2.5 text-[11.5px] font-mono" style={{ color: 'var(--danger)' }}>
              {avatarError}
            </p>
          )}
        </div>

        {/* ── Tab rail ──────────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 px-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          {TABS.map(({ id, label, icon }) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)}
                className="flex items-center gap-1.5 px-3 py-2.5 font-mono text-[12.5px] font-medium border-b-2 transition-colors"
                style={{ borderColor: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-dim)', marginBottom: '-1px' }}>
                {icon}
                {label}
              </button>
            );
          })}
        </div>

        {/* ── Tab content ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>

          {/* ── PROFILE ── */}
          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="p-5 space-y-4">
              {loadError && (
                <div className="px-3 py-2.5 rounded-lg text-[12px] font-mono"
                  style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                  {loadError}
                </div>
              )}

              {/* Display Name */}
              <div>
                <FieldLabel>Display Name</FieldLabel>
                <TextInput
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Your display name"
                />
              </div>

              {/* Email — read-only with envelope icon */}
              <div>
                <FieldLabel>Email</FieldLabel>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-dim)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <ReadonlyField>
                    <span style={{ paddingLeft: 24, display: 'block' }}>{profile?.email ?? '—'}</span>
                  </ReadonlyField>
                </div>
              </div>

              {/* Username — read-only with @ inset prefix */}
              <div>
                <FieldLabel>Username</FieldLabel>
                <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <span className="flex items-center px-3 font-mono text-[13px] flex-shrink-0"
                    style={{ background: 'var(--bg)', borderRight: '1px solid var(--border)', color: 'var(--text-dim)' }}>
                    @
                  </span>
                  <div className="flex-1 text-[13px] font-mono px-3 py-2.5"
                    style={{ background: 'var(--panel)', color: 'var(--text-dim)' }}>
                    {profile?.username ?? '—'}
                  </div>
                </div>
              </div>

              {/* Department — display-only with admin-only badge */}
              <div>
                <FieldLabel>
                  Department
                  <Badge tone="warning">admin only</Badge>
                </FieldLabel>
                <ReadonlyField>
                  {profile?.department
                    ? <span style={{ color: 'var(--text-dim)' }}>{profile.department}</span>
                    : <span style={{ fontStyle: 'italic' }}>Not assigned</span>}
                </ReadonlyField>
              </div>

              {/* Save button — transitions through Saving… → ✓ Saved */}
              <button type="submit" disabled={saving}
                className="w-full font-mono font-semibold text-[13px] disabled:opacity-50 transition-all"
                style={{
                  background: isSaved ? 'var(--success-wash)' : 'var(--accent)',
                  color: isSaved ? 'var(--success)' : '#fff',
                  border: `1px solid ${isSaved ? 'var(--success-border)' : 'var(--accent)'}`,
                  padding: '10px', borderRadius: 8,
                }}>
                {saving ? 'Saving…' : isSaved ? '✓ Saved' : 'Save changes'}
              </button>

              {saveMsg && !isSaved && (
                <p className="text-[12px] text-center font-mono" style={{ color: 'var(--danger)' }}>{saveMsg}</p>
              )}
            </form>
          )}

          {/* ── SECURITY ── */}
          {tab === 'security' && (
            <div className="p-5 space-y-4">

              {/* Change Password card */}
              <div className="rounded-xl p-5" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <h3 className="font-mono text-[10.5px] uppercase tracking-widest mb-4" style={{ color: 'var(--text-dim)' }}>
                  Change Password
                </h3>
                <form onSubmit={handleChangePassword} className="space-y-3">
                  {PW_FIELDS.map(({ key, val, set, ph }) => (
                    <div key={key} className="relative">
                      <input
                        type={showPws[key] ? 'text' : 'password'}
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        placeholder={ph}
                        className="w-full text-[13px] pr-10 focus:outline-none transition-colors"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 40px 9px 12px', color: 'var(--text)' }}
                        onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--accent)'; }}
                        onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'var(--border)'; }}
                      />
                      <button type="button"
                        onClick={() => setShowPws((p) => ({ ...p, [key]: !p[key] }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                        style={{ color: 'var(--text-dim)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; }}>
                        <IconEye off={showPws[key]} />
                      </button>
                    </div>
                  ))}

                  {/* Inline validation / server error */}
                  {pwMsg && (
                    <p className="text-[12px] font-mono px-1"
                      style={{ color: pwMsg === 'Password changed!' ? 'var(--success)' : 'var(--danger)' }}>
                      {pwMsg === 'Password changed!' ? '✓ ' : ''}{pwMsg}
                    </p>
                  )}

                  <button type="submit" disabled={!pwFilled}
                    className="w-full font-mono font-semibold text-[13px] disabled:opacity-35 transition-opacity"
                    style={{ background: 'var(--accent)', color: '#fff', padding: '10px', borderRadius: 8, border: '1px solid var(--accent)', marginTop: 4 }}>
                    Update password
                  </button>
                </form>
              </div>

              {/* 2FA card */}
              <div className="rounded-xl p-5" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-mono text-[10.5px] uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
                    Two-Factor Auth
                  </h3>
                  <Badge tone={totpEnabled ? 'success' : 'neutral'}>{totpEnabled ? 'Enabled' : 'Disabled'}</Badge>
                </div>
                <p className="text-[12px] font-mono mb-4" style={{ color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  Protect your account with a TOTP authenticator app.
                </p>

                {!totpEnabled && !totpQr && (
                  <button onClick={handleSetupTotp}
                    className="w-full font-mono font-semibold text-[13px] transition-opacity hover:opacity-90"
                    style={{ background: 'var(--accent)', color: '#fff', padding: '10px', borderRadius: 8, border: '1px solid var(--accent)' }}>
                    Set up 2FA
                  </button>
                )}

                {totpQr && (
                  <div className="space-y-3">
                    <img src={totpQr} alt="QR Code" className="w-36 h-36 mx-auto rounded-xl"
                      style={{ border: '1px solid var(--border)' }} />
                    <p className="text-[10px] text-center font-mono break-all" style={{ color: 'var(--text-dim)' }}>
                      Secret: <span style={{ color: 'var(--text)' }}>{totpSecret}</span>
                    </p>
                    <form onSubmit={handleEnableTotp} className="flex gap-2">
                      <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                        maxLength={6} placeholder="6-digit code"
                        className="flex-1 text-[13px] text-center tracking-widest focus:outline-none font-mono"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }} />
                      <button type="submit"
                        className="px-4 font-mono font-semibold text-[12px]"
                        style={{ background: 'var(--accent)', color: '#fff', borderRadius: 8, border: '1px solid var(--accent)' }}>
                        Activate
                      </button>
                    </form>
                  </div>
                )}

                {totpEnabled && (
                  <form onSubmit={handleDisableTotp} className="flex gap-2">
                    <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)}
                      maxLength={6} placeholder="Code to disable"
                      className="flex-1 text-[13px] text-center tracking-widest focus:outline-none font-mono"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)' }} />
                    <button type="submit"
                      className="px-4 font-mono font-semibold text-[12px]"
                      style={{ background: 'var(--danger-wash)', color: 'var(--danger)', borderRadius: 8, border: '1px solid var(--danger-border)' }}>
                      Disable
                    </button>
                  </form>
                )}

                {totpMsg && (
                  <p className="text-[11.5px] mt-3 font-mono" style={{ color: totpMsg.includes('!') || totpMsg.includes('Scan') ? 'var(--success)' : 'var(--text-dim)' }}>
                    {totpMsg}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── ALERTS ── */}
          {tab === 'alerts' && (
            <div className="p-5 space-y-2.5">
              <p className="font-mono text-[10.5px] uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>
                Notification Preferences
              </p>

              {ALERT_ITEMS.map(({ key, label, desc, icon }) => (
                <div key={key} className="rounded-xl overflow-hidden" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-4 px-4 py-3.5">
                    {/* Icon changes color when enabled */}
                    {icon(prefs[key])}

                    {/* Label + description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text)' }}>{label}</p>
                      <p className="text-[11.5px] font-mono mt-0.5 leading-tight" style={{ color: 'var(--text-dim)' }}>{desc}</p>
                    </div>

                    {/* Toggle — accent-green when on */}
                    <button type="button" onClick={() => handleTogglePref(key)}
                      className="relative flex-shrink-0 rounded-full transition-colors"
                      style={{ width: 40, height: 22, background: prefs[key] ? 'var(--success)' : 'var(--border)' }}>
                      <span className="absolute top-[4px] rounded-full transition-transform"
                        style={{ width: 14, height: 14, background: '#fff', left: 4, transform: prefs[key] ? 'translateX(18px)' : 'translateX(0)' }} />
                    </button>
                  </div>

                  {/* Desktop-only: browser permission state + a way to self-test right now */}
                  {key === 'desktopEnabled' && prefs.desktopEnabled && (
                    <div className="px-4 pb-3.5 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      {notifPermission === 'unsupported' ? (
                        <span className="text-[11.5px] font-mono" style={{ color: 'var(--text-dim)' }}>Not supported in this browser.</span>
                      ) : notifPermission === 'denied' ? (
                        <span className="text-[11.5px] font-mono" style={{ color: 'var(--danger)' }}>
                          Blocked by browser — allow notifications for this site in your browser settings.
                        </span>
                      ) : notifPermission === 'default' ? (
                        <span className="text-[11.5px] font-mono" style={{ color: 'var(--warning)' }}>Permission not yet granted.</span>
                      ) : (
                        <span className="text-[11.5px] font-mono" style={{ color: 'var(--success)' }}>{testSent ? '✓ Sent — check your OS notifications' : 'Enabled and working.'}</span>
                      )}
                      <button type="button" onClick={handleSendTestNotification} disabled={notifPermission !== 'granted'}
                        className="flex-shrink-0 font-mono text-[11.5px] font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ background: 'var(--accent-wash)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}>
                        Send test
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {prefsMsg && (
                <p className="text-[12px] text-center font-mono mt-2" style={{ color: 'var(--success)' }}>{prefsMsg}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Sign out footer ───────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-5 py-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 font-mono font-semibold text-[13px] py-2.5 rounded-lg transition-colors"
            style={{ background: 'var(--danger-wash)', color: 'var(--danger)', border: '1px solid var(--danger-border)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(0.92)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'none'; }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </div>

      {/* ── Avatar lightbox ───────────────────────────────────────────── */}
      {previewOpen && avatarUrl && (
        <div
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.82)' }}
          onClick={() => setPreviewOpen(false)}>
          {/* Image */}
          <img
            src={avatarUrl}
            alt="Profile photo"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '80%', maxHeight: '60%', borderRadius: 16, objectFit: 'contain', boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }}
          />
          {/* Actions row */}
          <div className="flex items-center gap-3 mt-5" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { setPreviewOpen(false); avatarInputRef.current?.click(); }}
              className="flex items-center gap-2 font-mono text-[12.5px] font-semibold px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Change photo
            </button>
            <button
              onClick={() => setPreviewOpen(false)}
              className="font-mono text-[12.5px] px-4 py-2 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
