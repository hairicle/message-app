'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../providers';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.push('/login');
  }, [token, router]);

  if (!token) return null;
  return <>{children}</>;
}
