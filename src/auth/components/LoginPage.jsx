import { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, LogIn, TriangleAlert, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, AlertDescription } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';

export default function LoginPage() {
  const { login, error, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    await login(username, password);
  }

  return (
    <div className="grid min-h-dvh bg-background font-sans text-foreground lg:grid-cols-[1.1fr_1fr]">
      {/* Image side (hidden on small screens) */}
      <aside
        aria-hidden="true"
        className="relative hidden items-end overflow-hidden bg-primary bg-[url('/login-hero.svg')] bg-cover bg-center p-12 lg:flex"
      >
        <div className="absolute inset-0 bg-gradient-to-t from-primary/85 to-transparent" />
        <div className="relative z-10 max-w-md text-white">
          <h2 className="mb-2 font-display text-4xl leading-tight font-extrabold tracking-tight">Try any look on, before it exists.</h2>
          <p className="text-base text-white/75">Describe an outfit, add your photos, and let the studio style it.</p>
        </div>
      </aside>

      {/* Form side */}
      <main className="grid place-items-center p-6">
        <Card className="w-full max-w-md rounded-2xl shadow-lg">
          <CardHeader className="gap-6">
            <div className="flex items-center gap-3">
              <div className="grid size-11 place-items-center rounded-xl bg-primary" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="size-6 fill-none stroke-[#ff7aa8] stroke-[1.8]" strokeLinejoin="round">
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
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="login-username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="login-username"
                    className="pl-9"
                    placeholder="Enter your username"
                    autoComplete="username"
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
                    className="px-9"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    aria-invalid={!!error}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
              </div>

              {error && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={loading || !username || !password}>
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
