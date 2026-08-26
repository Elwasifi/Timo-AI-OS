'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage() {
  const router = useRouter();
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const signUp = useAuthStore((s) => s.signUp);

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupNotice, setSignupNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSignupNotice(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const { error } = await signInWithPassword(email, password);
        if (error) {
          setError(error);
        } else {
          router.push('/dashboard');
        }
      } else {
        const { error } = await signUp(email, password, companyName || undefined);
        if (error) {
          setError(error);
        } else {
          setSignupNotice('Account created. Check your email to confirm, then sign in.');
          setMode('signin');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#020914] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-cyan-500/15 bg-[rgba(2,9,20,0.85)] p-8 shadow-[0_0_40px_rgba(0,180,255,0.08)] backdrop-blur-xl">
        <div className="mb-6 flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-cyan-300" />
          <div>
            <h1 className="text-lg font-semibold tracking-wide text-cyan-50">TEMO AI OS</h1>
            <p className="text-[10px] uppercase tracking-widest text-cyan-300/60">
              {mode === 'signin' ? 'Sign in to your workspace' : 'Create your workspace'}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <Label htmlFor="company" className="text-xs text-slate-400">Company / organization name</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc."
                className="mt-1"
              />
            </div>
          )}
          <div>
            <Label htmlFor="email" className="text-xs text-slate-400">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="password" className="text-xs text-slate-400">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {signupNotice && <p className="text-xs text-emerald-400">{signupNotice}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create workspace'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setSignupNotice(null);
          }}
          className="mt-4 w-full text-center text-xs text-cyan-300/70 hover:text-cyan-300"
        >
          {mode === 'signin' ? "Don't have a workspace? Create one" : 'Already have a workspace? Sign in'}
        </button>
      </div>
    </main>
  );
}
