import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function WarmupCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verifying connection...');

  useEffect(() => {
    const handleAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        if (!session) {
          setStatus('No session found. Please try again.');
          setTimeout(() => navigate('/warmup/seed-pool'), 2000);
          return;
        }

        const role = searchParams.get('role') || 'seed';
        const providerToken = session.provider_token;
        const providerRefreshToken = session.provider_refresh_token;

        if (!providerToken) {
          throw new Error('No provider token found. Ensure Google Auth is configured correctly.');
        }

        setStatus('Syncing account with warmup engine...');

        // Send to backend to save as a seed account
        await api.post('/warmup/connect-supabase-account', {
          email: session.user.email,
          provider_token: providerToken,
          provider_refresh_token: providerRefreshToken,
          role: role
        });

        toast.success('Gmail account connected successfully!');
        navigate('/warmup/seed-pool');
      } catch (err: any) {
        console.error('Auth callback error:', err);
        setStatus(`Error: ${err.message}`);
        toast.error(`Connection failed: ${err.message}`);
        setTimeout(() => navigate('/warmup/seed-pool'), 3000);
      }
    };

    handleAuth();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
      <div className="text-center space-y-4">
        <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
        <h1 className="text-xl font-bold tracking-tight">{status}</h1>
        <p className="text-slate-400 text-sm">Finishing up your Google connection...</p>
      </div>
    </div>
  );
}
