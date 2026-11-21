import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, LogIn, TriangleAlert, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';

const HERO_IMAGES = ['/Images/Login1.webp', '/Images/Login2.avif'];
const SLIDE_MS = 6000;

export default function LoginPage() {
  const { login, error, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [slide, setSlide] = useState(0);
  const [loaded, setLoaded] = useState({});

  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    // Decode the other slides in the background so the cross-fade never waits on the network.
    HERO_IMAGES.forEach((src) => {
      const img = new Image();
      img.src = src;
      img.decode?.().catch(() => {});
    });
  }, []);
  useEffect(() => {
    if (reduceMotion || HERO_IMAGES.length < 2) return undefined;
    const t = setInterval(() => setSlide((s) => (s + 1) % HERO_IMAGES.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [reduceMotion]);
  const markLoaded = (idx) => setLoaded((l) => (l[idx] ? l : { ...l, [idx]: true }));

  async function handleSubmit(e) {
    e.preventDefault();
    await login(username, password);
  }

  return (
    <div className="grid min-h-dvh bg-background font-sans text-foreground lg:grid-cols-[1.1fr_1fr]">
      {/* Image side (hidden on small screens): full-bleed slides that cross-fade */}
      <aside aria-hidden="true" className="relative hidden overflow-hidden bg-primary lg:block">
        {HERO_IMAGES.map((src, idx) => (
          <img
            key={src}
            src={src}
            alt=""
            decoding="async"
            fetchpriority={idx === 0 ? 'high' : 'low'}
            onLoad={() => markLoaded(idx)}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none ${
              idx === slide && loaded[idx] ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-t from-primary/85 via-primary/10 to-transparent" />
        <div className="absolute top-10 left-12 z-10 flex items-center gap-2.5 text-white">
          <span className="grid size-8 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-white stroke-[1.8]" strokeLinejoin="round">
              <path d="M12 3c1.5 0 2.3 1 2.3 2.2 0 1.1-.8 1.7-1.7 2.2L12 8l8 5c1 .7.9 2.2-.9 2.2H4.9C3.1 15.2 3 13.7 4 13l8-5" />
            </svg>
          </span>
          <span className="text-sm font-semibold tracking-wide">Fitting Room</span>
        </div>
        <div className="relative z-10 flex h-full flex-col justify-end p-12">
          <div key={slide} className="login-caption max-w-md text-white">
            <h2 className="mb-2 font-display text-4xl leading-tight font-extrabold tracking-tight">Try any look on, before it exists.</h2>
            <p className="text-base text-white/75">Describe an outfit, add your photos, and let the studio style it.</p>
          </div>
          {HERO_IMAGES.length > 1 && (
            <div className="mt-8 flex gap-2" aria-hidden="true">
              {HERO_IMAGES.map((_, idx) => (
                <span key={idx} className={`h-1 rounded-full bg-white transition-all duration-500 ${idx === slide ? 'w-8 opacity-100' : 'w-3 opacity-40'}`} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Form side */}
      <main className="grid place-items-center bg-[#f6f7f9] p-6 sm:p-10">
        <Card className="login-card w-full max-w-[400px] gap-7 rounded-md border-border/60 py-8 shadow-[0_18px_50px_-24px_rgba(14,26,43,0.28)]">
          <CardHeader className="gap-6">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-md bg-primary" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="size-6 fill-none stroke-white stroke-[1.8]" strokeLinejoin="round">
                  <path d="M12 3c1.5 0 2.3 1 2.3 2.2 0 1.1-.8 1.7-1.7 2.2L12 8l8 5c1 .7.9 2.2-.9 2.2H4.9C3.1 15.2 3 13.7 4 13l8-5" />
                </svg>
              </div>
              <div>
                <h1 className="font-display text-xl leading-none font-extrabold tracking-tight">Fitting Room</h1>
                <p className="mt-1 text-xs text-muted-foreground">AI Virtual Try-On Studio</p>
              </div>
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-extrabold tracking-tight">Welcome back</h2>
              <CardDescription>Sign in to continue to your studio</CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form className="login-form space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="login-username"
                    className="login-input h-11 rounded-md pl-9"
                    placeholder="Enter your username"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    aria-invalid={!!error}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="login-password"
                    type={showPwd ? 'text' : 'password'}
                    className="login-input h-11 rounded-md px-9"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    aria-invalid={!!error}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
                    onKeyUp={(e) => setCapsOn(e.getModifierState?.('CapsLock') ?? false)}
                    onBlur={() => setCapsOn(false)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={loading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
                {capsOn && (
                  <p role="status" className="login-hint text-xs text-muted-foreground">
                    Caps Lock is on.
                  </p>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" size="lg" className="login-submit h-11 w-full rounded-md text-[15px] font-semibold" disabled={loading || !username || !password}>
                {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>

          <CardFooter className="justify-center text-xs text-muted-foreground">Ask your administrator for an account.</CardFooter>
        </Card>
      </main>
    </div>
  );
}
