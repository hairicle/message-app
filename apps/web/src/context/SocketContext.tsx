'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../lib/api/client';
import { useAuth } from './AuthContext';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, logout } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    const instance = io('', { auth: { token } });
    setSocket(instance);

    // Server sends this when an admin disables the account
    instance.on('account:disabled', () => {
      instance.disconnect();
      logout();
      window.alert('Your account has been disabled by an administrator.');
    });

    return () => {
      instance.emit('user:offline');
      instance.disconnect();
    };
  }, [token, logout]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
