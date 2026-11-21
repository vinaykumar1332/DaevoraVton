import React from 'react';
import ReactDOM from 'react-dom/client';
// Cascade order matters: foundation (tokens, then shadcn/Tailwind), legacy, then theme last.
import './styles/foundation/tokens.css';
import './styles/foundation/tailwind.css';
import './styles/legacy/styles.css';
import './styles/legacy/ui.css';
import './styles/theme/studio.css';
import App from './App.jsx';
import { AuthProvider } from './auth/context/AuthContext.jsx';
import AuthGate from './auth/components/AuthGate.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </React.StrictMode>
);
