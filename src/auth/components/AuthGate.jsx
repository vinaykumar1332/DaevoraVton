import { useAuth } from '../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';

/** Renders the app only for a signed-in user, otherwise the login page. */
export default function AuthGate({ children }) {
  const { user } = useAuth();
  return user ? children : <LoginPage />;
}
