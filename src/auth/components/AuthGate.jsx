import { useAuth } from '../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';
import PageLoader from '@/components/common/PageLoader.jsx';

/** The app is shown only to a signed-in user. Everyone else sees the sign-in page. */
export default function AuthGate({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <PageLoader />;
  return user ? children : <LoginPage />;
}
