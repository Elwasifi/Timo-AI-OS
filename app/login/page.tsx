'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// M7-11: visual-only redesign toward a ChatGPT/Claude-style minimal login
// layout — generous whitespace, calm typography, a single clear primary
// action, understated branding instead of the previous heavy glow/neon
// card. No change to auth logic, field names/handlers, or behavior — only
// JSX/styling below.
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
    <main className="flex min-h-screen items-center justify-center bg-[#08090c] px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
            <Sparkles className="h-5 w-5 text-white/80" />
          </div>
          <h1 className="text-xl font-semibold text-white">
            {mode === 'signin' ? 'Welcome back' : 'Create your workspace'}
          </h1>
          <p className="mt-1.5 text-sm text-white/50">
            {mode === 'signin' ? 'Sign in to continue to Temo AI OS' : 'Get started with Temo AI OS'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          {mode === 'signup' && (
            <div>
              <Label htmlFor="company" className="sr-only">Company / organization name</Label>
              <Input
                id="company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company or organization name"
                className="h-11 rounded-lg border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/35 focus-visible:ring-white/20"
              />
            </div>
          )}
          <div>
            <Label htmlFor="email" className="sr-only">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="h-11 rounded-lg border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/35 focus-visible:ring-white/20"
            />
          </div>
          <div>
            <Label htmlFor="password" className="sr-only">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="h-11 rounded-lg border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/35 focus-visible:ring-white/20"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
          )}
          {signupNotice && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">{signupNotice}</p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-white text-sm font-medium text-black hover:bg-white/90"
          >
            {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create workspace'}
          </Button>
        </form>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-[11px] uppercase tracking-wider text-white/30">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setSignupNotice(null);
          }}
          className="mt-6 w-full text-center text-sm text-white/50 transition-colors hover:text-white"
        >
          {mode === 'signin' ? (
            <>Don&apos;t have a workspace? <span className="text-white/80 underline underline-offset-2">Create one</span></>
          ) : (
            <>Already have a workspace? <span className="text-white/80 underline underline-offset-2">Sign in</span></>
          )}
        </button>
      </div>
    </main>
  );
}
