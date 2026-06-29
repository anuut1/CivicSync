import React, { useState, useEffect } from 'react';
import { useStore } from './utils/store';
import MapPage from './pages/MapPage';
import AdminDashboard from './pages/AdminDashboard';
import axios from 'axios';
import { API_URL } from './api/client';

function App() {
  const { token, user, login, logout, setToast, updateIssue } = useStore();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('citizen');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('civisync_token');
    if (token) {
      axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => {
        useStore.setState({ user: res.data });
        localStorage.setItem('civisync_user', JSON.stringify(res.data));
      })
      .catch((err) => {
        console.error("Token verification failed, logging out:", err);
        logout();
      });
    }
  }, [logout]);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Listen to storage events for real-time multi-tab updates
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'civisync_issue_update') {
        try {
          const { issue } = JSON.parse(e.newValue);
          if (issue) {
            updateIssue(issue);
            const currentUser = useStore.getState().user;
            if (currentUser && issue.reporter_id === currentUser.id) {
              const statusLabel = issue.status.toUpperCase();
              setToast({
                message: `📢 Status Update: Your reported issue #${issue.id} has been marked as ${statusLabel}!`,
                type: 'success'
              });
              if (issue.status === 'resolved') {
                const updatedUser = { ...currentUser, xp: currentUser.xp + 15 };
                localStorage.setItem('civisync_user', JSON.stringify(updatedUser));
                useStore.setState({ user: updatedUser });
              }
            }
          }
        } catch (err) {
          console.error("Error handling storage update:", err);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [setToast, updateIssue]);

  // Deep Link ?issue=<id>
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const issueId = urlParams.get('issue');
    if (issueId && token) {
      import('./api/client').then(({ getIssueById }) => {
        getIssueById(parseInt(issueId))
          .then((res) => {
            const issue = res.data;
            useStore.getState().selectIssue(issue);
            const lat = parseFloat(issue.latitude);
            const lon = parseFloat(issue.longitude);
            if (!isNaN(lat) && !isNaN(lon)) {
              useStore.getState().setMapCenter([lat, lon]);
            }
          })
          .catch((err) => console.error("Error loading deep link issue:", err));
      });
    }
  }, [token]);

  const navigate = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const handleLogin = async (e, customEmail = null, customPass = null) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);
    const loginEmail = customEmail || email;
    const loginPassword = customPass || password || 'password';

    if (!loginEmail) {
      setError('Email is required');
      setLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, {
        email: loginEmail,
        password: loginPassword,
      });
      const { access_token, user: userData } = response.data;
      login(access_token, userData);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!name || !email || !password) {
      setError('All fields are required');
      setLoading(false);
      return;
    }

    try {
      await axios.post(`${API_URL}/api/auth/register`, {
        name,
        email,
        password,
        role,
      });
      // Auto login after registration
      await handleLogin(null, email, password);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  // Inline styles for Premium aesthetics
  const containerStyle = {
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: '#f4f6f8',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    boxSizing: 'border-box',
    color: '#1f2937',
  };

  const cardStyle = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.08)',
    padding: '32px 24px',
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
    textAlign: 'center',
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 16px',
    margin: '8px 0',
    borderRadius: '10px',
    border: '1px solid #e5e7eb',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  };

  const buttonStyle = {
    width: '100%',
    padding: '14px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '16px',
    boxSizing: 'border-box',
    boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)',
    transition: 'opacity 0.2s',
  };

  const quickLoginBtn = (roleType) => ({
    width: '48%',
    padding: '10px',
    backgroundColor: roleType === 'admin' ? '#1e293b' : '#dcfce7',
    color: roleType === 'admin' ? '#ffffff' : '#16a34a',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    margin: '4px 1%',
    boxSizing: 'border-box',
  });

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>📍</div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '28px', color: '#16a34a', fontWeight: '800' }}>civiSync</h1>
          <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: '#6b7280' }}>
            Hyperlocal civic issue reporting for Indian cities
          </p>

          {error && (
            <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '14px', textAlign: 'left' }}>
              {error}
            </div>
          )}

          <form onSubmit={isRegister ? handleRegister : handleLogin}>
            {isRegister && (
              <input
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              required
            />

            {isRegister && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', textAlign: 'left' }}>
                <span style={{ fontSize: '14px', color: '#4b5563' }}>Role:</span>
                <label style={{ fontSize: '14px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="role"
                    value="citizen"
                    checked={role === 'citizen'}
                    onChange={() => setRole('citizen')}
                    style={{ marginRight: '6px' }}
                  />
                  Citizen
                </label>
                <label style={{ fontSize: '14px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={role === 'admin'}
                    onChange={() => setRole('admin')}
                    style={{ marginRight: '6px' }}
                  />
                  Admin
                </label>
              </div>
            )}

            <button type="submit" disabled={loading} style={buttonStyle}>
              {loading ? 'Processing...' : isRegister ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div style={{ margin: '24px 0 12px 0', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', left: '0', right: '0', height: '1px', backgroundColor: '#e5e7eb', zIndex: '1' }}></div>
            <span style={{ position: 'relative', zIndex: '2', backgroundColor: '#ffffff', padding: '0 12px', fontSize: '12px', color: '#9ca3af', textTransform: 'uppercase' }}>
              Quick Access Test
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => handleLogin(null, 'john@citizen.org', 'citizen123')}
              style={quickLoginBtn('citizen')}
            >
              Citizen Login
            </button>
            <button
              onClick={() => handleLogin(null, 'admin@civisync.org', 'admin123')}
              style={quickLoginBtn('admin')}
            >
              Admin Login
            </button>
          </div>

          <p style={{ marginTop: '24px', fontSize: '14px', color: '#4b5563' }}>
            {isRegister ? 'Already have an account?' : 'New to civiSync?'}
            <span
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
              style={{ color: '#16a34a', fontWeight: 'bold', marginLeft: '6px', cursor: 'pointer' }}
            >
              {isRegister ? 'Login' : 'Register'}
            </span>
          </p>
        </div>
      </div>
    );
  }

  // Routing render
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {currentPath === '/admin' && user?.role?.toLowerCase() === 'admin' ? (
        <AdminDashboard navigate={navigate} />
      ) : (
        <MapPage navigate={navigate} />
      )}
      <ToastNotification />
    </div>
  );
}

function ToastNotification() {
  const { toast, setToast } = useStore();
  
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, setToast]);
  
  if (!toast) return null;
  
  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: '#1e293b',
      color: '#ffffff',
      padding: '12px 24px',
      borderRadius: '12px',
      boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
      zIndex: 2000,
      fontSize: '14px',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      border: '1.5px solid #16a34a',
      animation: 'fadeInDown 0.3s ease-out'
    }}>
      <span>🔔</span>
      <span>{toast.message}</span>
      <button 
        onClick={() => setToast(null)}
        style={{
          background: 'none',
          border: 'none',
          color: '#9ca3af',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '0 0 0 8px',
          fontWeight: 'bold'
        }}
      >
        &times;
      </button>
    </div>
  );
}

export default App;
