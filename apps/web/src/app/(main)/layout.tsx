'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm" style={{ color: 'var(--text-dim)' }}>
        Loading…
      </div>
    );
  }

  if (!user) return null;
  return <div className="h-screen overflow-hidden">{children}</div>;
}
