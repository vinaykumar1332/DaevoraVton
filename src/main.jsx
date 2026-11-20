import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';
import './styles/styles.css';
import './styles/ui.css';
import './styles/studio.css';
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
