import React, { useState, useEffect, useRef } from 'react';
import { useStore } from './utils/store';
import MapPage from './pages/MapPage';
import AdminDashboard from './pages/AdminDashboard';
import axios from 'axios';
import { API_URL } from './api/client';

function App() {
  const { token, user, login, logout, setToast, updateIssue } = useStore();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [isRegister, setIsRegister] = useState(false);
  
  // Basic login states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('citizen');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Password visibility states
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  // Forgot password flow states
  const [forgotPasswordStep, setForgotPasswordStep] = useState(0); // 0 = standard login, 1 = email, 2 = otp, 3 = reset password
  const [otpEmail, setOtpEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);

  const otpRefs = useRef([...Array(6)].map(() => React.createRef()));
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 768;

  useEffect(() => {
    const tokenVal = localStorage.getItem('civisync_token');
    if (tokenVal) {
      axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenVal}` }
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

  // Protected route guard: Redirect unauthenticated users to root / immediately
  useEffect(() => {
    const localToken = localStorage.getItem('civisync_token');
    if (!localToken && currentPath !== '/') {
      window.location.href = '/';
    }
  }, [currentPath]);

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

    if (!name || !email || !password || !confirmPassword) {
      setError('All fields are required');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
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
      await handleLogin(null, email, password);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  // Forgot password flow handlers
  const handleForgotPasswordSubmit = async (e) => {
    if (e) e.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordMessage('');
    setForgotPasswordLoading(true);

    if (!otpEmail) {
      setForgotPasswordError('Email is required');
      setForgotPasswordLoading(false);
      return;
    }

    try {
      await axios.post(`${API_URL}/api/auth/forgot-password`, { email: otpEmail });
      setForgotPasswordMessage('OTP sent to your email');
      setForgotPasswordStep(2);
    } catch (err) {
      console.error(err);
      setForgotPasswordError(err.response?.data?.detail || 'Failed to send OTP. User may not exist.');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value.substring(value.length - 1);
    setOtpDigits(newDigits);
    if (forgotPasswordError) setForgotPasswordError('');

    // Auto-focus next input
    if (value && index < 5) {
      otpRefs.current[index + 1].current.focus();
    }

    // Auto submit when fully completed
    if (newDigits.every(d => d !== '') && newDigits.length === 6) {
      handleOtpVerify(newDigits.join(''));
    }
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1].current.focus();
    }
  };

  const handleOtpVerify = async (otpValue) => {
    setForgotPasswordError('');
    setForgotPasswordMessage('');
    setForgotPasswordLoading(true);

    try {
      await axios.post(`${API_URL}/api/auth/verify-otp`, { email: otpEmail, otp: otpValue });
      setForgotPasswordStep(3);
    } catch (err) {
      console.error(err);
      setForgotPasswordError(err.response?.data?.detail || 'Invalid or expired OTP');
      setOtpDigits(['', '', '', '', '', '']);
      if (otpRefs.current[0].current) {
        otpRefs.current[0].current.focus();
      }
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e) => {
    if (e) e.preventDefault();
    setForgotPasswordError('');
    setForgotPasswordMessage('');
    setForgotPasswordLoading(true);

    if (newPassword.length < 8) {
      setForgotPasswordError('Password must be minimum 8 characters');
      setForgotPasswordLoading(false);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setForgotPasswordError('Passwords do not match');
      setForgotPasswordLoading(false);
      return;
    }

    const otpValue = otpDigits.join('');

    try {
      await axios.post(`${API_URL}/api/auth/reset-password`, {
        email: otpEmail,
        otp: otpValue,
        new_password: newPassword
      });
      setForgotPasswordMessage('Password reset successfully');
      setTimeout(() => {
        setForgotPasswordStep(0);
        setEmail(otpEmail);
        setPassword('');
        setOtpEmail('');
        setOtpDigits(['', '', '', '', '', '']);
        setNewPassword('');
        setConfirmNewPassword('');
        setForgotPasswordMessage('');
        setForgotPasswordError('');
      }, 2000);
    } catch (err) {
      console.error(err);
      setForgotPasswordError(err.response?.data?.detail || 'Failed to reset password');
    } finally {
      setForgotPasswordLoading(false);
    }
  };

  // Redesigned premium styles
  const mainGridStyle = {
    display: 'grid',
    gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  };

  const leftBannerStyle = {
    display: isMobile ? 'none' : 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '48px',
    background: 'linear-gradient(135deg, #0f172a 0%, #0f4c5c 50%, #065f46 100%)',
    backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(135deg, #0f172a 0%, #0f4c5c 50%, #065f46 100%)`,
    backgroundSize: '40px 40px, 40px 40px, auto',
    color: '#ffffff',
    height: '100%',
    boxSizing: 'border-box',
    position: 'relative',
    animation: 'slideInLeft 0.4s ease-out'
  };

  const rightFormPanelStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isMobile ? '40px 24px' : '48px',
    backgroundColor: isMobile ? '#f8fafc' : '#ffffff',
    height: '100%',
    overflowY: 'auto',
    boxSizing: 'border-box',
    animation: 'fadeIn 0.4s ease-out'
  };

  const formCardStyle = {
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box'
  };

  const inputStyle = {
    width: '100%',
    height: '44px',
    border: '1.5px solid #e2e8f0',
    borderRadius: '10px',
    padding: '0 14px',
    fontSize: '14px',
    background: '#f8fafc',
    color: '#0f172a',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'all 0.15s'
  };

  const primaryBtnStyle = {
    width: '100%',
    height: '44px',
    background: 'linear-gradient(135deg, #0f4c5c, #065f46)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'opacity 0.15s, transform 0.1s'
  };

  const inputGroupStyle = {
    position: 'relative',
    marginBottom: '14px',
    width: '100%'
  };

  const passwordToggleStyle = {
    position: 'absolute',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#94a3b8',
    fontSize: '16px',
    padding: 0
  };

  if (!token) {
    return (
      <div style={mainGridStyle}>
        <style>{`
          @keyframes slideInLeft {
            from { transform: translateX(-30px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          input:focus {
            border-color: #0f4c5c !important;
            background: #ffffff !important;
            box-shadow: 0 0 0 3px rgba(15, 76, 92, 0.1) !important;
          }
          button.primary:hover { opacity: 0.92; transform: translateY(-1px); }
          button.primary:active { transform: translateY(0); }
          .forgot-link:hover { text-decoration: underline !important; }
        `}</style>

        {/* Left Side: Brand side */}
        <div style={leftBannerStyle}>
          {/* Top Brand Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              📍
            </div>
            <span style={{ fontSize: '28px', fontWeight: '600', color: '#ffffff', letterSpacing: '-0.5px' }}>
              CivicSync
            </span>
          </div>

          {/* Middle Content */}
          <div style={{ margin: '40px 0' }}>
            <h1 style={{ fontSize: '36px', fontWeight: '700', lineHeight: 1.2, margin: '0 0 24px 0' }}>
              Your city. Your voice. Your impact.
            </h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px' }}>
                <span>📍</span>
                <span>Report issues in seconds</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px' }}>
                <span>🤖</span>
                <span>AI-powered categorisation</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '15px' }}>
                <span>🏆</span>
                <span>Earn XP and track your impact</span>
              </div>
            </div>
          </div>

          {/* Bottom Statistics */}
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', fontWeight: '500' }}>
            847 issues resolved &middot; 2,341 citizens &middot; 18 wards covered
          </div>
        </div>

        {/* Right Side: Form side */}
        <div style={rightFormPanelStyle}>
          <div style={formCardStyle}>
            {/* Mobile Logo Branding */}
            {isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', justifyContent: 'center' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #0f4c5c, #065f46)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px'
                }}>
                  📍
                </div>
                <span style={{ fontSize: '24px', fontWeight: '800', background: 'linear-gradient(135deg, #0f4c5c, #065f46)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  CivicSync
                </span>
              </div>
            )}

            {forgotPasswordStep === 0 ? (
              // LOGIN / REGISTER FORM SCREEN
              <div className="animate-tab-switch" key={isRegister ? 'register' : 'login'}>
                <div style={{ marginBottom: '20px', textAlign: isMobile ? 'center' : 'left' }}>
                  <h2 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: '600', color: '#0f172a' }}>
                    {isRegister ? 'Create an account' : 'Welcome back'}
                  </h2>
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                    {isRegister ? 'Get started with your CivicSync profile' : 'Sign in to your CivicSync account'}
                  </p>
                </div>

                {/* Tab Switcher */}
                <div style={{ display: 'flex', border: '1.5px solid #e2e8f0', borderRadius: '100px', padding: '4px', marginBottom: '20px', backgroundColor: '#f8fafc' }}>
                  <button
                    type="button"
                    onClick={() => { setIsRegister(false); setError(''); }}
                    style={{
                      flex: 1,
                      padding: '8px',
                      border: 'none',
                      borderRadius: '100px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      backgroundColor: !isRegister ? '#0f172a' : 'transparent',
                      color: !isRegister ? '#ffffff' : '#64748b',
                      transition: 'all 0.2s'
                    }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsRegister(true); setError(''); }}
                    style={{
                      flex: 1,
                      padding: '8px',
                      border: 'none',
                      borderRadius: '100px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      backgroundColor: isRegister ? '#0f172a' : 'transparent',
                      color: isRegister ? '#ffffff' : '#64748b',
                      transition: 'all 0.2s'
                    }}
                  >
                    Register
                  </button>
                </div>

                {error && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#dc2626', marginBottom: '16px' }}>
                    {error}
                  </div>
                )}

                <form onSubmit={isRegister ? handleRegister : handleLogin}>
                  {isRegister && (
                    <div style={inputGroupStyle}>
                      <input
                        type="text"
                        placeholder="Full Name"
                        value={name}
                        onChange={(e) => { setName(e.target.value); if (error) setError(''); }}
                        style={inputStyle}
                        disabled={loading}
                        required
                      />
                    </div>
                  )}

                  <div style={inputGroupStyle}>
                    <input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                      style={inputStyle}
                      disabled={loading}
                      required
                    />
                  </div>

                  <div style={inputGroupStyle}>
                    <input
                      type={isRegister ? (showRegPassword ? 'text' : 'password') : (showPassword ? 'text' : 'password')}
                      placeholder="Password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                      style={{ ...inputStyle, paddingRight: '40px' }}
                      disabled={loading}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => isRegister ? setShowRegPassword(!showRegPassword) : setShowPassword(!showPassword)}
                      style={passwordToggleStyle}
                      aria-label={isRegister ? (showRegPassword ? 'Hide password' : 'Show password') : (showPassword ? 'Hide password' : 'Show password')}
                    >
                      {isRegister ? (showRegPassword ? '🙈' : '👁️') : (showPassword ? '🙈' : '👁️')}
                    </button>
                  </div>

                  {isRegister && (
                    <div style={inputGroupStyle}>
                      <input
                        type={showRegConfirmPassword ? 'text' : 'password'}
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(''); }}
                        style={{ ...inputStyle, paddingRight: '40px' }}
                        disabled={loading}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                        style={passwordToggleStyle}
                        aria-label={showRegConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showRegConfirmPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  )}

                  {!isRegister && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                      <span
                        onClick={() => {
                          setForgotPasswordStep(1);
                          setForgotPasswordError('');
                          setForgotPasswordMessage('');
                          setOtpEmail(email);
                        }}
                        className="forgot-link"
                        style={{
                          fontSize: '13px',
                          color: '#0f4c5c',
                          cursor: 'pointer',
                          fontWeight: '500',
                          textDecoration: 'none'
                        }}
                      >
                        Forgot password?
                      </span>
                    </div>
                  )}

                  {isRegister && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', padding: '0 4px' }}>
                      <span style={{ fontSize: '13.5px', color: '#475569' }}>Role:</span>
                      <label style={{ fontSize: '13.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="radio"
                          name="role"
                          value="citizen"
                          checked={role === 'citizen'}
                          onChange={() => setRole('citizen')}
                          disabled={loading}
                        />
                        Citizen
                      </label>
                      <label style={{ fontSize: '13.5px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="radio"
                          name="role"
                          value="admin"
                          checked={role === 'admin'}
                          onChange={() => setRole('admin')}
                          disabled={loading}
                        />
                        Admin
                      </label>
                    </div>
                  )}

                  <button type="submit" disabled={loading} className="primary" style={primaryBtnStyle}>
                    {loading ? (
                      <>
                        <svg className="animate-spin" style={{ width: '18px', height: '18px', color: '#ffffff' }} viewBox="0 0 24 24" fill="none">
                          <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>{isRegister ? 'Creating Account...' : 'Signing in...'}</span>
                      </>
                    ) : (
                      <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
                    )}
                  </button>
                </form>

                {isRegister && (
                  <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '10px', textAlign: 'center' }}>
                    By registering you agree to our Terms of Service
                  </p>
                )}

                {/* Divider */}
                <div style={{ margin: '24px 0 16px 0', position: 'relative', textAlign: 'center' }}>
                  <div style={{ position: 'absolute', top: '50%', left: '0', right: '0', height: '1px', backgroundColor: '#e2e8f0', zIndex: '1' }} />
                  <span style={{ position: 'relative', zIndex: '2', backgroundColor: isMobile ? '#f8fafc' : '#ffffff', padding: '0 12px', fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>
                    or sign in with email
                  </span>
                </div>

                {/* Quick Access Grid */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => handleLogin(null, 'john@citizen.org', 'citizen123')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      height: '40px',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: '10px',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    👤 Continue as Citizen
                  </button>
                  <button
                    onClick={() => handleLogin(null, 'admin@civisync.org', 'admin123')}
                    disabled={loading}
                    style={{
                      flex: 1,
                      height: '40px',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: '10px',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    🛡️ Continue as Admin
                  </button>
                </div>
              </div>
            ) : (
              // FORGOT PASSWORD STEP FLOW
              <div className="animate-tab-switch" key={`forgot-step-${forgotPasswordStep}`}>
                <div style={{ marginBottom: '20px', textAlign: isMobile ? 'center' : 'left' }}>
                  <h2 style={{ margin: '0 0 4px 0', fontSize: '24px', fontWeight: '600', color: '#0f172a' }}>
                    Forgot Password
                  </h2>
                  <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>
                    {forgotPasswordStep === 1 && 'Enter your email to receive an OTP code'}
                    {forgotPasswordStep === 2 && `Enter the 6-digit OTP code sent to ${otpEmail}`}
                    {forgotPasswordStep === 3 && 'Choose a new secure password'}
                  </p>
                </div>

                {forgotPasswordError && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#dc2626', marginBottom: '16px' }}>
                    {forgotPasswordError}
                  </div>
                )}

                {forgotPasswordMessage && (
                  <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#15803d', marginBottom: '16px' }}>
                    {forgotPasswordMessage}
                  </div>
                )}

                {forgotPasswordStep === 1 && (
                  // STEP 1: EMAIL ENTRY
                  <form onSubmit={handleForgotPasswordSubmit}>
                    <div style={inputGroupStyle}>
                      <input
                        type="email"
                        placeholder="Registered Email address"
                        value={otpEmail}
                        onChange={(e) => { setOtpEmail(e.target.value); if (forgotPasswordError) setForgotPasswordError(''); }}
                        style={inputStyle}
                        disabled={forgotPasswordLoading}
                        required
                      />
                    </div>
                    <button type="submit" disabled={forgotPasswordLoading} className="primary" style={primaryBtnStyle}>
                      {forgotPasswordLoading ? 'Sending...' : 'Send OTP'}
                    </button>
                  </form>
                )}

                {forgotPasswordStep === 2 && (
                  // STEP 2: OTP DIGITS INPUT
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', margin: '20px 0' }}>
                      {otpDigits.map((digit, index) => (
                        <input
                          key={index}
                          ref={otpRefs.current[index]}
                          type="text"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(index, e)}
                          style={{
                            width: '48px',
                            height: '48px',
                            border: '1.5px solid #e2e8f0',
                            borderRadius: '10px',
                            textAlign: 'center',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            background: '#f8fafc',
                            color: '#0f172a',
                            outline: 'none',
                            transition: 'all 0.15s'
                          }}
                          disabled={forgotPasswordLoading}
                        />
                      ))}
                    </div>
                    <button 
                      type="button" 
                      onClick={() => handleOtpVerify(otpDigits.join(''))} 
                      disabled={forgotPasswordLoading || otpDigits.some(d => d === '')}
                      className="primary" 
                      style={primaryBtnStyle}
                    >
                      {forgotPasswordLoading ? 'Verifying...' : 'Verify OTP'}
                    </button>
                  </div>
                )}

                {forgotPasswordStep === 3 && (
                  // STEP 3: RESET PASSWORD ENTRY
                  <form onSubmit={handleResetPasswordSubmit}>
                    <div style={inputGroupStyle}>
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        placeholder="New Password"
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); if (forgotPasswordError) setForgotPasswordError(''); }}
                        style={{ ...inputStyle, paddingRight: '40px' }}
                        disabled={forgotPasswordLoading}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        style={passwordToggleStyle}
                      >
                        {showNewPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                    <div style={inputGroupStyle}>
                      <input
                        type={showConfirmNewPassword ? 'text' : 'password'}
                        placeholder="Confirm new password"
                        value={confirmNewPassword}
                        onChange={(e) => { setConfirmNewPassword(e.target.value); if (forgotPasswordError) setForgotPasswordError(''); }}
                        style={{ ...inputStyle, paddingRight: '40px' }}
                        disabled={forgotPasswordLoading}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                        style={passwordToggleStyle}
                      >
                        {showConfirmNewPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                    <button type="submit" disabled={forgotPasswordLoading} className="primary" style={primaryBtnStyle}>
                      {forgotPasswordLoading ? 'Saving...' : 'Reset Password'}
                    </button>
                  </form>
                )}

                {/* Back to Login */}
                <div style={{ marginTop: '24px', textAlign: 'center' }}>
                  <span
                    onClick={() => setForgotPasswordStep(0)}
                    style={{ fontSize: '13px', color: '#0f4c5c', fontWeight: '600', cursor: 'pointer' }}
                  >
                    &larr; Back to login
                  </span>
                </div>
              </div>
            )}
          </div>
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
