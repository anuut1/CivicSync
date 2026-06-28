import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import IssueMap from '../components/IssueMap';
import ReportForm from '../components/ReportForm';
import IssuePanel from '../components/IssuePanel';
import ChatBot from '../components/ChatBot';
import { getUserLeaderboard } from '../api/client';

const badgeIcons = {
  'First Report': { emoji: '🏅', description: 'Awarded for filing your first report.' },
  'Pothole Hunter': { emoji: '🕳️', description: 'Awarded for reporting a pothole hazard.' },
  'Night Owl': { emoji: '🦉', description: 'Awarded for filing a report between 8 PM - 5 AM.' },
  'Streak': { emoji: '🔥', description: 'Awarded for reporting 3 issues in 7 days.' }
};

const getLevelInfo = (xp) => {
  if (xp >= 150) return { title: 'Ward Champion', min: 150, max: 150, color: '#f59e0b' };
  if (xp >= 100) return { title: 'Community Hero', min: 100, max: 150, color: '#8b5cf6' };
  if (xp >= 50) return { title: 'Verified Citizen', min: 50, max: 100, color: '#3b82f6' };
  if (xp >= 20) return { title: 'Reporter', min: 20, max: 50, color: '#10b981' };
  return { title: 'Newcomer', min: 0, max: 20, color: '#64748b' };
};

function MapPage({ navigate }) {
  const { 
    user, 
    logout, 
    setShowReport
  } = useStore();

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState('week'); // 'week' | 'month'
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  // Fetch leaderboard data when profile opens
  useEffect(() => {
    if (isProfileOpen) {
      setLoadingLeaderboard(true);
      getUserLeaderboard()
        .then((res) => {
          setLeaderboard(res.data);
          setLoadingLeaderboard(false);
        })
        .catch((err) => {
          console.error("Failed to load user leaderboard:", err);
          setLoadingLeaderboard(false);
        });
    }
  }, [isProfileOpen]);

  const handleLogout = () => {
    logout();
  };

  // Get user badges
  const parsedBadges = (() => {
    try {
      return typeof user?.badges === 'string' 
        ? JSON.parse(user?.badges || '[]') 
        : (user?.badges || []);
    } catch {
      return [];
    }
  })();

  const levelInfo = getLevelInfo(user?.xp || 0);
  const progressPercent = levelInfo.max === levelInfo.min 
    ? 100 
    : Math.min(100, Math.max(0, ((user?.xp - levelInfo.min) / (levelInfo.max - levelInfo.min)) * 100));

  // Sort leaderboard list
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    if (leaderboardTab === 'week') return b.weekly_xp - a.weekly_xp;
    return b.monthly_xp - a.monthly_xp;
  });

  // Styles
  const pageContainerStyle = {
    position: 'relative',
    width: '100vw',
    height: '100vh',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  // Style objects cleaned up

  const legendStyle = {
    position: 'absolute',
    bottom: '20px',
    left: '84px', // Shifted right to prevent overlap with GPS button
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    boxShadow: '0 4px 15px rgba(0,0,0,0.12)',
    padding: '10px 12px',
    zIndex: 500,
    fontSize: '12px',
    color: '#374151',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  };

  const legendItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const legendDotStyle = (color) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: color,
    display: 'inline-block',
  });

  const fabStyle = {
    position: 'absolute',
    bottom: '32px',
    right: '20px',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    fontSize: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 15px rgba(22, 163, 74, 0.4)',
    zIndex: 500,
    lineHeight: '56px',
  };

  // PROFILE DRAWER OVERLAY & PANEL
  const drawerOverlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
    zIndex: 790,
    display: isProfileOpen ? 'block' : 'none',
    backdropFilter: 'blur(2px)',
  };

  const drawerPanelStyle = {
    position: 'absolute',
    top: 0,
    left: isProfileOpen ? 0 : '-380px',
    width: '360px',
    height: '100%',
    backgroundColor: '#ffffff',
    boxShadow: '5px 0 30px rgba(0, 0, 0, 0.15)',
    zIndex: 800,
    transition: 'left 0.3s ease-in-out',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 20px',
    boxSizing: 'border-box',
    overflowY: 'auto',
  };

  const badgeCardStyle = (unlocked) => ({
    flex: '1 0 45%',
    backgroundColor: unlocked ? '#f8fafc' : '#f1f5f9',
    borderRadius: '12px',
    padding: '12px',
    boxSizing: 'border-box',
    border: `1.5px solid ${unlocked ? '#e2e8f0' : '#e2e8f0'}`,
    opacity: unlocked ? 1 : 0.55,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  });

  const getRankArrow = (val) => {
    if (val > 0) return <span style={{ color: '#22c55e', fontWeight: 'bold' }}>▲</span>;
    if (val < 0) return <span style={{ color: '#ef4444', fontWeight: 'bold' }}>▼</span>;
    return <span style={{ color: '#94a3b8', fontWeight: 'bold' }}>●</span>;
  };

  return (
    <div style={pageContainerStyle}>
      {/* Map Component */}
      <IssueMap />

      {/* Top Left Logo & Profile Card removed - Profile button is now floating bottom-left */}

      {/* PROFILE SLIDE OUT DRAWER */}
      <div style={drawerOverlayStyle} onClick={() => setIsProfileOpen(false)} />
      <div style={drawerPanelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>Citizen Profile</h2>
          <button
            onClick={() => setIsProfileOpen(false)}
            style={{ border: 'none', background: 'none', fontSize: '24px', fontWeight: 'bold', color: '#94a3b8', cursor: 'pointer' }}
          >
            &times;
          </button>
        </div>

        {/* User Details & Quick Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '14px', color: '#0f172a', fontWeight: 'bold' }}>
            Logged in as: <span style={{ color: '#16a34a' }}>{user?.name}</span> ({user?.role})
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {user?.role?.toLowerCase() === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#1e293b',
                  color: '#ffffff',
                  fontWeight: 'bold',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Admin Panel 🛠️
              </button>
            )}
            <button
              onClick={handleLogout}
              style={{
                flex: 1,
                padding: '8px',
                borderRadius: '8px',
                border: '1.5px solid #dc2626',
                backgroundColor: 'transparent',
                color: '#dc2626',
                fontWeight: 'bold',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Logout 🚪
            </button>
          </div>
        </div>

        {/* User XP and title */}
        <div style={{ backgroundColor: '#f8fafc', borderRadius: '16px', padding: '16px', border: '1.5px solid #e2e8f0', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#475569' }}>LEVEL STATUS</span>
            <span style={{ fontSize: '12px', fontWeight: '800', color: levelInfo.color, textTransform: 'uppercase', backgroundColor: levelInfo.color + '15', padding: '3px 8px', borderRadius: '6px' }}>
              {levelInfo.title}
            </span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
            {user?.xp || 0} <span style={{ fontSize: '14px', color: '#64748b', fontWeight: '600' }}>Total XP</span>
          </div>
          
          {/* Progress bar to next level */}
          <div style={{ height: '8px', backgroundColor: '#e2e8f0', borderRadius: '4px', overflow: 'hidden', margin: '12px 0 6px 0' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: levelInfo.color, transition: 'width 0.4s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
            <span>{levelInfo.min} XP</span>
            <span>{levelInfo.max === levelInfo.min ? 'MAX LEVEL' : `${levelInfo.max} XP`}</span>
          </div>
        </div>

        {/* Badges Section */}
        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Badges Unlocked ({Object.keys(badgeIcons).filter(b => parsedBadges.includes(b)).length}/4)
        </h3>
        
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '24px' }}>
          {Object.entries(badgeIcons).map(([badgeName, details]) => {
            const unlocked = parsedBadges.includes(badgeName);
            return (
              <div key={badgeName} style={badgeCardStyle(unlocked)}>
                <span style={{ fontSize: '28px', display: 'block', marginBottom: '4px', filter: unlocked ? 'none' : 'grayscale(1)' }}>
                  {details.emoji}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: unlocked ? '#0f172a' : '#64748b', display: 'block' }}>
                  {badgeName}
                </span>
                <p style={{ margin: '4px 0 0 0', fontSize: '10px', color: '#94a3b8', lineHeight: '1.2' }}>
                  {unlocked ? details.description : 'Locked'}
                </p>
              </div>
            );
          })}
        </div>

        {/* Leaderboard Section */}
        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Leaderboard
        </h3>

        <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderRadius: '10px', padding: '4px', marginBottom: '12px' }}>
          <button
            onClick={() => setLeaderboardTab('week')}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              backgroundColor: leaderboardTab === 'week' ? '#ffffff' : 'transparent',
              color: leaderboardTab === 'week' ? '#0f172a' : '#64748b',
              boxShadow: leaderboardTab === 'week' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            This Week
          </button>
          <button
            onClick={() => setLeaderboardTab('month')}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              backgroundColor: leaderboardTab === 'month' ? '#ffffff' : 'transparent',
              color: leaderboardTab === 'month' ? '#0f172a' : '#64748b',
              boxShadow: leaderboardTab === 'month' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            This Month
          </button>
        </div>

        {loadingLeaderboard ? (
          <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '13px', color: '#64748b' }}>
            Loading top citizens...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedLeaderboard.map((item, index) => {
              const rank = index + 1;
              const itemXP = leaderboardTab === 'week' ? item.weekly_xp : item.monthly_xp;
              const isCurrentUser = item.id === user?.id;

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    backgroundColor: isCurrentUser ? '#dcfce7' : '#f8fafc',
                    border: `1.5px solid ${isCurrentUser ? '#bbf7d0' : '#e2e8f0'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', width: '20px', color: '#475569' }}>
                      #{rank}
                    </span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#0f172a' }}>
                        {item.name} {isCurrentUser && '👤'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        {item.level}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'right' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: '#16a34a' }}>
                        +{itemXP} XP
                      </div>
                    </div>
                    {getRankArrow(item.rank_movement)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Profile Button */}
      <button
        onClick={() => setIsProfileOpen(true)}
        style={{
          position: 'absolute',
          bottom: '32px',
          left: '20px',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          backgroundColor: '#ffffff',
          border: 'none',
          boxShadow: '0 4px 18px rgba(0,0,0,0.15)',
          zIndex: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          transition: 'all 0.2s',
        }}
        title="My Profile"
      >
        👤
      </button>

      {/* Floating Admin Panel Shortcut */}
      {user?.role?.toLowerCase() === 'admin' && (
        <button
          onClick={() => navigate('/admin')}
          style={{
            position: 'absolute',
            bottom: '96px',
            left: '20px',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            backgroundColor: '#1e293b',
            color: '#ffffff',
            border: 'none',
            boxShadow: '0 4px 18px rgba(0,0,0,0.2)',
            zIndex: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
            transition: 'all 0.2s',
          }}
          title="Admin Panel Dashboard"
        >
          🛠️
        </button>
      )}

      {/* Legend Bottom Left */}
      <div style={legendStyle}>
        <div style={{ fontWeight: 'bold', marginBottom: '2px', fontSize: '11px', textTransform: 'uppercase', color: '#9ca3af' }}>Severity</div>
        <div style={legendItemStyle}>
          <span style={legendDotStyle('#22c55e')}></span>
          <span>Minor (1-2)</span>
        </div>
        <div style={legendItemStyle}>
          <span style={legendDotStyle('#f59e0b')}></span>
          <span>Significant (3)</span>
        </div>
        <div style={legendItemStyle}>
          <span style={legendDotStyle('#ef4444')}></span>
          <span>Critical (4)</span>
        </div>
      </div>

      {/* Floating Action Button (Citizens only) */}
      {user?.role?.toLowerCase() === 'citizen' && (
        <button
          onClick={() => setShowReport(true)}
          style={fabStyle}
          aria-label="Report Issue"
        >
          +
        </button>
      )}

      {/* AI Assistant Chatbot */}
      <ChatBot />

      {/* Bottom Sheet Modal Components */}
      <ReportForm />
      <IssuePanel />
    </div>
  );
}

export default MapPage;
