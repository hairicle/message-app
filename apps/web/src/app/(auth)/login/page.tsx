'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/context/AuthContext';
import { BrandLogo } from '@/components/BrandLogo';

type Step = 'credentials' | 'totp';

export default function LoginPage() {
  const { login, completeTotpLogin } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpToken, setTotpToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const deviceName = () =>
    `web-${typeof navigator !== 'undefined' && navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop'}`;

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password, deviceName());
      if (result?.requiresTotp) {
        setTotpToken(result.totpToken);
        setStep('totp');
      } else {
        router.push('/chat');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await completeTotpLogin(totpToken, totpCode, deviceName());
      router.push('/chat');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setTotpCode('');
    setError(null);
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <BrandLogo height={72} maxWidth={260} className="mb-4" />
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Internal Messenger</h1>
          <p className="text-[13.5px] mt-1" style={{ color: 'var(--text-dim)' }}>
            {step === 'credentials' ? 'Sign in with your company account' : 'Enter your two-factor code'}
          </p>
        </div>

        {/* Card */}
        {step === 'credentials' ? (
          <form
            onSubmit={handleCredentialsSubmit}
            className="rounded-2xl p-8 flex flex-col gap-4"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
          >
            <div>
              <label htmlFor="email" className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
                Email
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-dim)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="you@company.local"
                  className="input-base w-full"
                  style={{ paddingLeft: 32 }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
                Password
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: 'var(--text-dim)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="input-base w-full"
                  style={{ paddingLeft: 32, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-dim)' }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[12.5px] font-mono"
                style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full justify-center mt-1 disabled:opacity-60">
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleTotpSubmit}
            className="rounded-2xl p-8 flex flex-col gap-4"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
          >
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-dim)' }}>
              Enter the 6-digit code from your authenticator app.
            </p>

            <div>
              <label htmlFor="totp" className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-dim)' }}>
                Verification code
              </label>
              <input
                id="totp"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                placeholder="000000"
                className="input-base w-full text-center tracking-[0.5em] font-mono text-[18px]"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[12.5px] font-mono"
                style={{ background: 'var(--danger-wash)', border: '1px solid var(--danger-border)', color: 'var(--danger)' }}>
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting || totpCode.length !== 6} className="btn-primary w-full justify-center mt-1 disabled:opacity-40">
              {submitting ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button type="button" onClick={backToCredentials} className="font-mono text-[12.5px] transition-colors" style={{ color: 'var(--text-dim)' }}>
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
