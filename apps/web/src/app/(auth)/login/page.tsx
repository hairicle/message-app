'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../providers';
import type { LoginResponse, TotpRequiredResponse } from '@messenger/shared';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (requiresTotp) {
        const res = await fetch('/api/auth/login/totp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ totpToken, code: totpCode }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Invalid code');
        const data = (await res.json()) as LoginResponse;
        login(data.token, data.user);
        router.push('/chat');
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? 'Login failed');
        const data = (await res.json()) as LoginResponse | TotpRequiredResponse;
        if ('requiresTotp' in data && data.requiresTotp) {
          setTotpToken(data.totpToken);
          setRequiresTotp(true);
        } else {
          login((data as LoginResponse).token, (data as LoginResponse).user);
          router.push('/chat');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold mb-8 text-center" style={{ color: 'var(--text)' }}>
          {requiresTotp ? 'Two-factor verification' : 'Sign in'}
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {!requiresTotp ? (
            <>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-deep)', borderColor: 'var(--border)',
                  color: 'var(--text)', '--tw-ring-color': 'var(--accent)',
                } as React.CSSProperties}
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-deep)', borderColor: 'var(--border)',
                  color: 'var(--text)', '--tw-ring-color': 'var(--accent)',
                } as React.CSSProperties}
              />
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: 'var(--text-dim)' }}>
                Enter the 6-digit code from your authenticator app.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                className="w-full px-4 py-2.5 rounded-lg border text-center text-xl tracking-widest outline-none focus:ring-2"
                style={{
                  background: 'var(--bg-deep)', borderColor: 'var(--border)',
                  color: 'var(--text)', '--tw-ring-color': 'var(--accent)',
                } as React.CSSProperties}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Please wait…' : requiresTotp ? 'Verify' : 'Sign in'}
          </button>

          {requiresTotp && (
            <button
              type="button"
              onClick={() => { setRequiresTotp(false); setTotpCode(''); setTotpToken(''); }}
              className="text-sm text-center"
              style={{ color: 'var(--text-dim)' }}
            >
              Back to login
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
