import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { auth } from '../lib/firebase';

export function AccountGuard() {
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading');
  const location = useLocation();
  const [checkedPath, setCheckedPath] = useState('');
  useEffect(() => {
    let active = true;
    let generation = 0;
    const check = async () => {
      const current = ++generation;
      setState('loading');
      try {
        if (!auth.currentUser) throw new Error('No account');
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/auth/session`, {
          headers: { Authorization: `Bearer ${token}`, 'X-Toowix-Session': localStorage.getItem('toowix_session_token') || '' },
        });
        if (!response.ok) throw new Error('Not authorized');
        const data = await response.json();
        if (active && current === generation) { localStorage.setItem('toowix_user', JSON.stringify(data.user)); setCheckedPath(location.pathname); setState('allowed'); }
      } catch { if (active && current === generation) setState('denied'); }
    };
    const unsubscribe = auth.onIdTokenChanged(check);
    window.addEventListener('focus', check);
    const timer = window.setInterval(check, 60000);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', check); clearInterval(timer); };
  }, [location.pathname]);
  if (state === 'loading' || (state === 'allowed' && checkedPath !== location.pathname)) return <div role="status" style={{ padding: 40 }}>Checking account access...</div>;
  return state === 'allowed' ? <Outlet /> : <Navigate to="/login" replace />;
}
