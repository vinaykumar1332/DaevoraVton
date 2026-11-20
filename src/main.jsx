import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrimeReactProvider } from 'primereact/api';
import 'primereact/resources/themes/lara-light-indigo/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import './styles/styles.css';
import './styles/ui.css';
import './styles/studio.css';
import App from './App.jsx';
import { AuthProvider } from './auth/context/AuthContext.jsx';
import AuthGate from './auth/components/AuthGate.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PrimeReactProvider>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </PrimeReactProvider>
  </React.StrictMode>
);
