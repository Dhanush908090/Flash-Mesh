import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

// OAuth Callback handling for popup/standalone web flow
if (window.location.hash.includes('access_token=')) {
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (token) {
    const isDropbox = !window.location.hash.includes('scope');
    const key = isDropbox ? 'dropbox_token' : 'google_token';
    localStorage.setItem(key, token);
    try {
      window.close();
    } catch (e) {
      console.warn("Could not close popup window automatically", e);
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
