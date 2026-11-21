import { lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';
import PageLoader from '@/components/common/PageLoader.jsx';

const MarketingSite = lazy(() => import('@/marketing/MarketingSite.jsx'));

// Signed-out visitors see the public pages on these paths. Every other path shows the sign-in form.
const PUBLIC_PAGES = { '/': 'landing', '/pricing': 'pricing', '/about': 'about' };

/** Renders the app only for a signed-in user. Signed-out visitors get the public pages or the login page. */
export default function AuthGate({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <PageLoader />;
  if (user) return children;
  const page = PUBLIC_PAGES[window.location.pathname.replace(/\/+$/, '') || '/'];
  if (!page) return <LoginPage />;
  return (
    <Suspense fallback={<PageLoader />}>
      <MarketingSite page={page} />
    </Suspense>
  );
}
