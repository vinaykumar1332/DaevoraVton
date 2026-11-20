import { useAuth } from '../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';
import PageLoader from '@/components/common/PageLoader.jsx';

/** Renders the app only for a signed-in user, otherwise the login page. */
export default function AuthGate({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <PageLoader />;
  return user ? children : <LoginPage />;
}
