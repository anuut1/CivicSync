import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { 
  getAdminMetrics, 
  getMapIssues, 
  compilePredictions, 
  getActiveAlerts, 
  getLeaderboard,
  API_URL
} from '../api/client';
import axios from 'axios';
import { MapContainer, TileLayer, Polygon, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const categoryEmojis = {
  pothole: '🕳️',
  water_leak: '💧',
  broken_light: '💡',
  waste: '🗑️',
  other: '⚠️'
};

const getRiskColor = (risk) => {
  const r = risk?.toLowerCase();
  if (r === 'low') return '#16a34a';
  if (r === 'medium') return '#d97706';
  return '#dc2626'; // high
};

const getSeverityDetails = (severity) => {
  const s = Number(severity);
  if (s === 1) return { label: 'Minor', color: '#22c55e' };
  if (s === 2) return { label: 'Moderate', color: '#84cc16' };
  if (s === 3) return { label: 'Significant', color: '#f59e0b' };
  if (s === 4) return { label: 'Severe', color: '#f97316' };
  return { label: 'Critical', color: '#ef4444' };
};

// Dynamic Ward Polygons Coordinates based on issue bounds
const getDynamicWardPolygons = (issuesList) => {
  if (issuesList.length === 0) {
    return {
      "Downtown Ward 1": {
        polygon: [[13.09, 80.25], [13.09, 80.29], [13.07, 80.29], [13.07, 80.25]],
        center: [13.08, 80.27]
      },
      "North Heights Ward 2": {
        polygon: [[13.12, 80.25], [13.12, 80.29], [13.09, 80.29], [13.09, 80.25]],
        center: [13.105, 80.27]
      },
      "West End Ward 3": {
        polygon: [[13.09, 80.21], [13.09, 80.25], [13.06, 80.25], [13.06, 80.21]],
        center: [13.075, 80.23]
      }
    };
  }
  
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  issuesList.forEach(i => {
    const lat = parseFloat(i.latitude);
    const lon = parseFloat(i.longitude);
    if (!isNaN(lat) && !isNaN(lon)) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  });

  if (minLat === 90 || minLat === maxLat || minLon === maxLon) {
    const baseLat = minLat !== 90 ? minLat : 13.0827;
    const baseLon = minLon !== 180 ? minLon : 80.2707;
    return {
      "Downtown Ward 1": {
        polygon: [[baseLat + 0.01, baseLon - 0.02], [baseLat + 0.01, baseLon + 0.02], [baseLat - 0.01, baseLon + 0.02], [baseLat - 0.01, baseLon - 0.02]],
        center: [baseLat, baseLon]
      },
      "North Heights Ward 2": {
        polygon: [[baseLat + 0.03, baseLon - 0.02], [baseLat + 0.03, baseLon + 0.02], [baseLat + 0.01, baseLon + 0.02], [baseLat + 0.01, baseLon - 0.02]],
        center: [baseLat + 0.02, baseLon]
      },
      "West End Ward 3": {
        polygon: [[baseLat + 0.01, baseLon - 0.06], [baseLat + 0.01, baseLon - 0.02], [baseLat - 0.01, baseLon - 0.02], [baseLat - 0.01, baseLon - 0.06]],
        center: [baseLat, baseLon - 0.04]
      }
    };
  }
  
  const latPadding = Math.max(0.01, (maxLat - minLat) * 0.1);
  const lonPadding = Math.max(0.01, (maxLon - minLon) * 0.1);
  minLat -= latPadding;
  maxLat += latPadding;
  minLon -= lonPadding;
  maxLon += lonPadding;
  
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  
  const lon1 = minLon + lonSpan / 3;
  const lon2 = minLon + (lonSpan / 3) * 2;
  
  return {
    "West End Ward 3": {
      polygon: [[maxLat, minLon], [maxLat, lon1], [minLat, lon1], [minLat, minLon]],
      center: [minLat + latSpan / 2, minLon + (lon1 - minLon) / 2]
    },
    "Downtown Ward 1": {
      polygon: [[maxLat, lon1], [maxLat, lon2], [minLat, lon2], [minLat, lon1]],
      center: [minLat + latSpan / 2, lon1 + (lon2 - lon1) / 2]
    },
    "North Heights Ward 2": {
      polygon: [[maxLat, lon2], [maxLat, maxLon], [minLat, maxLon], [minLat, lon2]],
      center: [minLat + latSpan / 2, lon2 + (maxLon - lon2) / 2]
    }
  };
};

// Sub-component to fly map to coordinates on drill-down
function MapDrillDown({ targetCenter }) {
  const map = useMap();
  useEffect(() => {
    if (targetCenter) {
      map.setView(targetCenter, 14);
    }
  }, [targetCenter, map]);
  return null;
}

function AdminDashboard({ navigate }) {
  const { user } = useStore();
  
  // Tabs: 'queue' | 'map' | 'alerts' | 'leaderboard'
  const [activeTab, setActiveTab] = useState('queue');
  
  // Metrics States
  const [metrics, setMetrics] = useState({
    resolved_this_month: 0,
    avg_resolution_time_hours: 0.0,
    most_active_ward: 'None',
    total_verified_reporters: 0
  });

  // Data States
  const [issues, setIssues] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [wardLeaderboard, setWardLeaderboard] = useState([]);
  const [deptLeaderboard, setDeptLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [predicting, setPredicting] = useState(false);

  // Proactive Scan System States
  const [scanPhase, setScanPhase] = useState(1); // 1 = selection, 2 = running/results
  const [selectedScans, setSelectedScans] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState([]);
  const [scanStatus, setScanStatus] = useState('');

  // Daily AI Briefings
  const [briefing, setBriefing] = useState(null);
  const [prevBriefings, setPrevBriefings] = useState([]);
  const [showBriefingCard, setShowBriefingCard] = useState(true);
  const [showBriefingsModal, setShowBriefingsModal] = useState(false);

  // Filters for Queue
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterWard, setFilterWard] = useState('all');
  const [sortField, setSortField] = useState('severity'); // 'severity' | 'date' | 'age'

  // Map view drill-down center
  const [drillCenter, setDrillCenter] = useState(null);

  // Assign & Resolve Modals
  const [assigningIssue, setAssigningIssue] = useState(null);
  const [assigneeDept, setAssigneeDept] = useState('Roads & Highways Department');
  const [etaDays, setEtaDays] = useState(3);

  const [resolvingIssue, setResolvingIssue] = useState(null);
  const [proofImage, setProofImage] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('civisync_token');
      const [metricsRes, alertsRes, leaderboardRes, mapIssuesRes, deptsRes, briefingsRes] = await Promise.all([
        getAdminMetrics(),
        getActiveAlerts(),
        getLeaderboard(),
        getMapIssues({ include_resolved: true }),
        axios.get(`${API_URL}/api/public/departments`),
        axios.get(`${API_URL}/api/admin/briefings`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setMetrics(metricsRes.data);
      setAlerts(alertsRes.data);
      setWardLeaderboard(leaderboardRes.data);
      setIssues(mapIssuesRes.data);
      setDeptLeaderboard(deptsRes.data);

      if (briefingsRes.data && briefingsRes.data.length > 0) {
        setBriefing(briefingsRes.data[0]);
        setPrevBriefings(briefingsRes.data.slice(1));
      }
    } catch (err) {
      console.error('Failed to load admin dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const localToken = localStorage.getItem('civisync_token');
    const localUser = localStorage.getItem('civisync_user');
    if (!localToken || !localUser) {
      window.location.href = '/';
      return;
    }
    fetchAllData();
  }, []);

  const handleRunScans = async (scansToRun) => {
    setScanPhase(2);
    setScanning(true);
    setScanResults([]);
    setScanStatus('Initiating proactive checkup scan...');

    try {
      const token = localStorage.getItem('civisync_token');
      // Using fetch readable stream reader for Server-Sent Events (SSE) stream consumption
      const response = await fetch(`${API_URL}/api/admin/predictions/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ scan_types: scansToRun })
      });

      if (!response.ok) {
        throw new Error('Scan request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const dataStr = trimmed.slice(6);
              const data = JSON.parse(dataStr);
              if (data.status) {
                setScanStatus(data.status);
              } else if (data.scan_type && data.results) {
                setScanResults(prev => {
                  const filtered = prev.filter(r => r.scan_type !== data.scan_type);
                  return [...filtered, data];
                });
              }
            } catch (e) {
              console.error('Error parsing SSE line:', e);
            }
          }
        }
      }

      setScanStatus('Checkup scan complete.');
    } catch (err) {
      console.error(err);
      setScanStatus('Scan failed: ' + err.message);
    } finally {
      setScanning(false);
    }
  };

  const handleExportPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const content = `
      <html>
        <head>
          <title>civiSync Proactive Scan Report</title>
          <style>
            body { font-family: sans-serif; padding: 20px; color: #1e293b; }
            h1 { color: #0f4c5c; margin-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #cbd5e1; padding: 12px; text-align: left; }
            th { background-color: #f1f5f9; }
            .badge { padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 12px; text-transform: uppercase; }
            .Critical { background-color: #fee2e2; color: #dc2626; }
            .High { background-color: #ffedd5; color: #ea580c; }
            .Medium { background-color: #fef9c3; color: #ca8a04; }
            .Low { background-color: #dcfce7; color: #16a34a; }
          </style>
        </head>
        <body>
          <h1>civiSync Proactive Scan Report</h1>
          <p>Generated on ${new Date().toLocaleDateString()}</p>
          <table>
            <thead>
              <tr>
                <th>Scan Type</th>
                <th>Ward</th>
                <th>Risk Level</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>Timeframe</th>
                <th>Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              ${scanResults.map(r => (r.results || []).map(item => `
                <tr>
                  <td><strong>${r.scan_type.toUpperCase()}</strong></td>
                  <td>${item.ward_name}</td>
                  <td><span class="badge ${item.risk_level}">${item.risk_level}</span></td>
                  <td>${item.category || item.predicted_issue_category}</td>
                  <td>${item.confidence_percent || item.confidence}%</td>
                  <td>${item.predicted_timeframe || item.timeframe}</td>
                  <td>${item.recommended_action}</td>
                </tr>
              `).join('')).join('')}
            </tbody>
          </table>
          <script>window.print();</script>
        </body>
      </html>
    `;
    printWindow.document.write(content);
    printWindow.document.close();
  };

  // Assign to department action
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (!assigningIssue || !assigneeDept) return;
    
    setActionLoading(true);
    try {
      const token = localStorage.getItem('civisync_token');
      const response = await axios.post(
        `${API_URL}/api/issues/${assigningIssue.id}/assign`,
        { assigned_to: assigneeDept, eta_days: Number(etaDays) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const updatedIssue = response.data;
      
      setIssues(prev => prev.map(i => i.id === updatedIssue.id ? updatedIssue : i));
      setAssigningIssue(null);
      localStorage.setItem('civisync_issue_update', JSON.stringify({ issue: updatedIssue, updater: 'admin', timestamp: Date.now() }));
      await fetchAllData();
    } catch (err) {
      console.error(err);
      alert('Assignment failed.');
    } finally {
      setActionLoading(false);
    }
  };

  // Resolve issue action
  const handleResolveSubmit = async (e) => {
    e.preventDefault();
    if (!resolvingIssue || !proofImage) return;

    setActionLoading(true);
    try {
      const token = localStorage.getItem('civisync_token');
      const formData = new FormData();
      formData.append('resolved_image', proofImage);

      const response = await axios.post(
        `${API_URL}/api/issues/${resolvingIssue.id}/resolve`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
      );
      const updatedIssue = response.data.issue;

      setIssues(prev => prev.map(i => i.id === updatedIssue.id ? { ...i, ...updatedIssue } : i));
      setResolvingIssue(null);
      setProofImage(null);
      setProofPreview(null);

      localStorage.setItem('civisync_issue_update', JSON.stringify({ issue: { ...resolvingIssue, ...updatedIssue }, updater: 'admin', timestamp: Date.now() }));
      await fetchAllData();
    } catch (err) {
      console.error(err);
      alert('Failed to resolve issue.');
    } finally {
      setActionLoading(false);
    }
  };

  // Filter & Sort Work Queue
  const filteredIssues = issues.filter(issue => {
    const isVerifiedOrAssigned = issue.status === 'verified' || issue.status === 'assigned';
    if (!isVerifiedOrAssigned) return false;

    if (filterCategory !== 'all' && issue.category !== filterCategory) return false;
    if (filterWard !== 'all' && issue.ward !== filterWard) return false;
    return true;
  });

  const sortedIssues = [...filteredIssues].sort((a, b) => {
    if (sortField === 'severity') return b.severity - a.severity;
    if (sortField === 'age') {
      // Oldest unresolved first (urgency sorting red to top)
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // date
  });

  const getWardDensityColor = (wardName) => {
    const activeCount = issues.filter(i => i.ward === wardName && i.status !== 'resolved').length;
    if (activeCount === 0) return '#22c55e'; // Green
    if (activeCount <= 2) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
  };

  const getRiskArrow = (risk) => {
    const r = risk?.toLowerCase();
    if (r === 'high') return <span style={{ color: '#ef4444', fontSize: '18px', fontWeight: 'bold' }}>▲</span>;
    if (r === 'medium') return <span style={{ color: '#f59e0b', fontSize: '18px', fontWeight: 'bold' }}>▶</span>;
    return <span style={{ color: '#22c55e', fontSize: '18px', fontWeight: 'bold' }}>▼</span>;
  };

  // Calculate total max cost of unresolved issues (Estimated Backlog Cost)
  const backlogCostMax = issues
    .filter(i => i.status !== 'resolved')
    .reduce((sum, i) => sum + (i.cost_max || 0), 0);

  // Styles
  const containerStyle = {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px 16px',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    boxSizing: 'border-box',
    color: '#0f172a',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  };

  const recompileBtnStyle = {
    padding: '10px 14px',
    backgroundColor: '#16a34a',
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 4px 10px rgba(22, 163, 74, 0.2)',
  };

  const metricsGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '12px',
    marginBottom: '24px',
  };

  const metricCard = {
    backgroundColor: '#ffffff',
    border: '1.5px solid #e2e8f0',
    borderRadius: '16px',
    padding: '14px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
  };

  const metricVal = {
    fontSize: '20px',
    fontWeight: '800',
    color: '#16a34a',
    margin: '4px 0 0 0',
  };

  const metricTitle = {
    fontSize: '11px',
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  };

  const tabContainerStyle = {
    display: 'flex',
    backgroundColor: '#e2e8f0',
    borderRadius: '12px',
    padding: '4px',
    marginBottom: '20px',
  };

  const tabBtnStyle = (active) => ({
    flex: 1,
    padding: '10px 4px',
    border: 'none',
    borderRadius: '8px',
    fontWeight: '700',
    fontSize: '12px',
    cursor: 'pointer',
    backgroundColor: active ? '#ffffff' : 'transparent',
    color: active ? '#0f172a' : '#64748b',
    boxShadow: active ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
  });

  const queueCardStyle = (needsReview) => ({
    backgroundColor: needsReview ? '#fef2f2' : '#ffffff',
    border: `1.5px solid ${needsReview ? '#fca5a5' : '#e2e8f0'}`,
    borderLeft: needsReview ? '5px solid #ef4444' : '1.5px solid #e2e8f0',
    borderRadius: '16px',
    padding: '16px',
    marginBottom: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
  });

  const actionBtnStyle = (variant = 'primary') => ({
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '12px',
    fontWeight: 'bold',
    cursor: 'pointer',
    backgroundColor: variant === 'resolve' ? '#16a34a' : '#2563eb',
    color: '#ffffff',
    marginRight: '6px',
  });

  const modalOverlay = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    backdropFilter: 'blur(2px)',
  };

  const modalContent = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px 20px',
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
  };

  return (
    <div style={containerStyle}>
      {/* Header bar */}
      <div style={headerStyle}>
        <div>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '4px',
            }}
          >
            &larr; Back to Map
          </button>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800' }}>Admin Console</h1>
        </div>

      </div>

      {/* Daily AI Briefing Dismissible Banner (Feature 12) */}
      {briefing && showBriefingCard && (
        <div style={{
          background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
          border: '1.5px solid #ddd6fe',
          borderRadius: '16px',
          padding: '16px',
          marginBottom: '20px',
          position: 'relative',
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.05)'
        }}>
          <button
            onClick={() => setShowBriefingCard(false)}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: '#7c3aed',
              fontWeight: 'bold'
            }}
          >
            &times;
          </button>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '800', color: '#6d28d9', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>⚡</span> Daily AI Morning Briefing ({briefing.date})
          </h3>
          <p style={{ margin: '0 0 12px 0', fontSize: '13.5px', color: '#4c1d95', lineHeight: '1.45', whiteSpace: 'pre-line' }}>
            {briefing.content}
          </p>
          <button
            onClick={() => setShowBriefingsModal(true)}
            style={{
              backgroundColor: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(124, 58, 237, 0.2)'
            }}
          >
            📜 View 7-Day Previous Briefings
          </button>
        </div>
      )}

      {/* Metrics Grid */}
      <div style={metricsGrid}>
        <div style={metricCard}>
          <span style={metricTitle}>Resolved This Month</span>
          <p style={metricVal}>{metrics.resolved_this_month}</p>
        </div>
        <div style={metricCard}>
          <span style={metricTitle}>Avg Resolution Time</span>
          <p style={metricVal}>{metrics.avg_resolution_time_hours} hrs</p>
        </div>
        <div style={metricCard}>
          <span style={metricTitle}>Estimated Backlog Cost</span>
          <p style={{ ...metricVal, color: '#b91c1c' }}>₹{backlogCostMax.toLocaleString()}</p>
        </div>
        <div style={metricCard}>
          <span style={metricTitle}>Verified Reporters</span>
          <p style={metricVal}>{metrics.total_verified_reporters}</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabContainerStyle}>
        <button onClick={() => setActiveTab('queue')} style={tabBtnStyle(activeTab === 'queue')}>
          Work Queue
        </button>
        <button onClick={() => setActiveTab('map')} style={tabBtnStyle(activeTab === 'map')}>
          Map View
        </button>
        <button onClick={() => setActiveTab('alerts')} style={tabBtnStyle(activeTab === 'alerts')}>
          AI Predictions
        </button>
        <button onClick={() => setActiveTab('leaderboard')} style={tabBtnStyle(activeTab === 'leaderboard')}>
          Leaderboard
        </button>
      </div>

      {/* TAB CONTENT: WORK QUEUE */}
      {activeTab === 'queue' && (
        <div>
          {/* Sorting and Filtering Bar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            >
              <option value="all">All Categories</option>
              <option value="pothole">Potholes</option>
              <option value="water_leak">Leaks</option>
              <option value="broken_light">Streetlights</option>
              <option value="waste">Waste</option>
              <option value="other">Other</option>
            </select>

            <select
              value={filterWard}
              onChange={(e) => setFilterWard(e.target.value)}
              style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            >
              <option value="all">All Wards</option>
              <option value="Downtown Ward 1">Downtown Ward 1</option>
              <option value="North Heights Ward 2">North Heights Ward 2</option>
              <option value="West End Ward 3">West End Ward 3</option>
            </select>

            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              style={{ padding: '8px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', fontWeight: 'bold' }}
            >
              <option value="severity">Sort: Severity 🔥</option>
              <option value="date">Sort: Date 📅</option>
              <option value="age">Sort: Age/Urgency ⌛</option>
            </select>
          </div>

          {sortedIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#ffffff', borderRadius: '16px', color: '#64748b' }}>
              No verified issues in work queue.
            </div>
          ) : (
            sortedIssues.map((issue) => {
              const sevDetails = getSeverityDetails(issue.severity);
              const isUrgent = (Date.now() - new Date(issue.created_at).getTime()) > 7 * 24 * 60 * 60 * 1000;
              return (
                <div key={issue.id} style={queueCardStyle(issue.needs_review)}>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <img src={issue.image_url} alt="hazard" style={{ width: '60px', height: '60px', borderRadius: '10px', objectFit: 'cover' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e2e8f0' }}>
                          {categoryEmojis[issue.category] || '⚠️'} {issue.category?.replace('_', ' ') || 'other'}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', backgroundColor: sevDetails.color + '15', color: sevDetails.color }}>
                          {sevDetails.label}
                        </span>
                        {isUrgent && (
                          <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#ef4444' }}>
                            ⌛ OVERDUE
                          </span>
                        )}
                      </div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>{issue.ai_summary || issue.description}</h4>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>📍 {issue.address_string} ({issue.ward})</div>
                      
                      {/* Cost details range */}
                      {issue.cost_max !== null && (
                        <div style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: '700', marginTop: '4px' }}>
                          💰 Est. Cost: ₹{issue.cost_min?.toLocaleString()} - ₹{issue.cost_max?.toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Highlight AI Scorer review warnings */}
                  {issue.needs_review && (
                    <div style={{
                      backgroundColor: '#fee2e2',
                      border: '1px solid #fca5a5',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      fontSize: '11.5px',
                      color: '#991b1b',
                      marginBottom: '10px',
                      fontWeight: '700'
                    }}>
                      ⚠️ AI Scorer flagged Poor Quality Repair: {issue.ai_repair_score}/10 verdict "{issue.ai_repair_verdict}"
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 'bold', color: issue.status === 'assigned' ? '#2563eb' : '#64748b' }}>
                      Status: {issue.status} {issue.assigned_to && `(Assigned to ${issue.assigned_to})`}
                    </span>
                    <div>
                      <button onClick={() => setAssigningIssue(issue)} style={actionBtnStyle('assign')}>
                        Assign
                      </button>
                      <button onClick={() => setResolvingIssue(issue)} style={actionBtnStyle('resolve')}>
                        Resolve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB CONTENT: MAP VIEW WITH HEAT OVERLAY */}
      {activeTab === 'map' && (
        <div style={{ height: '380px', width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1.5px solid #cbd5e1' }}>
          <MapContainer 
            center={issues.length > 0 && !isNaN(parseFloat(issues[0].latitude))
              ? [parseFloat(issues[0].latitude), parseFloat(issues[0].longitude)]
              : [13.0827, 80.2707]} 
            zoom={12} 
            zoomControl={false} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapDrillDown targetCenter={drillCenter} />
            
            {Object.entries(getDynamicWardPolygons(issues)).map(([wardName, data]) => {
              const densityColor = getWardDensityColor(wardName);
              return (
                <Polygon
                  key={wardName}
                  positions={data.polygon}
                  pathOptions={{
                    fillColor: densityColor,
                    fillOpacity: 0.35,
                    color: densityColor,
                    weight: 2
                  }}
                  eventHandlers={{
                    click: () => {
                      setDrillCenter(data.center);
                    }
                  }}
                />
              );
            })}

            {issues.filter(i => i.status !== 'resolved').map((issue) => {
              const sevColor = getSeverityDetails(issue.severity).color;
              return (
                <CircleMarker
                  key={issue.id}
                  center={[parseFloat(issue.latitude), parseFloat(issue.longitude)]}
                  radius={7}
                  pathOptions={{
                    fillColor: sevColor,
                    fillOpacity: 0.9,
                    color: '#ffffff',
                    weight: 1.5
                  }}
                />
              );
            })}
          </MapContainer>
        </div>
      )}

      {/* TAB CONTENT: AI PREDICTIONS */}
      {activeTab === 'alerts' && (
        <div>
          {scanPhase === 1 ? (
            // PHASE 1: CHECKUP OPTIONS SCREEN
            <div>
              <div style={{ marginBottom: '24px', textAlign: 'center' }}>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 'bold', color: '#0f172a' }}>
                  Proactive City Risk Checkup
                </h3>
                <p style={{ margin: 0, fontSize: '13.5px', color: '#475569' }}>
                  Select one or multiple risk checkup scans to run diagnostics. Estimated time: ~15 seconds per scan.
                </p>
              </div>

              {/* 3x2 Scan Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
              }}>
                {[
                  { id: 'pothole', icon: '🕳️', title: 'Pothole Risk Scan', desc: 'Analyse road condition patterns and rainfall data to forecast pothole hotspots next 30 days' },
                  { id: 'water', icon: '💧', title: 'Water Infrastructure Scan', desc: 'Identify wards at risk of pipe bursts or leak surges based on issue history and seasonal data' },
                  { id: 'streetlight', icon: '💡', title: 'Streetlight Failure Scan', desc: 'Predict which wards will see electrical failures based on complaint frequency trends' },
                  { id: 'waste', icon: '🗑️', title: 'Waste Management Scan', desc: 'Forecast overflow risk areas based on collection gaps and complaint density' },
                  { id: 'monsoon', icon: '⛈️', title: 'Post-Monsoon Impact Scan', desc: 'Full ward-by-ward risk assessment for the upcoming monsoon season' },
                  { id: 'full', icon: '🏥', title: 'Full City Health Scan', desc: 'Run all five scans simultaneously and generate a complete city risk briefing' }
                ].map((scan) => {
                  const isSelected = selectedScans.includes(scan.id);
                  return (
                    <div
                      key={scan.id}
                      onClick={() => {
                        setSelectedScans(prev =>
                          isSelected ? prev.filter(s => s !== scan.id) : [...prev, scan.id]
                        );
                      }}
                      style={{
                        backgroundColor: '#ffffff',
                        border: isSelected ? '2px solid #0f4c5c' : '1.5px solid #e2e8f0',
                        borderRadius: '16px',
                        padding: '16px',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.15s',
                        boxShadow: isSelected ? '0 4px 15px rgba(15, 76, 92, 0.08)' : 'none',
                      }}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // Handled by parent onClick
                        style={{
                          position: 'absolute',
                          right: '16px',
                          top: '16px',
                          cursor: 'pointer',
                          width: '16px',
                          height: '16px',
                          accentColor: '#0f4c5c'
                        }}
                      />
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>{scan.icon}</div>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 'bold', color: '#0f172a' }}>
                        {scan.title}
                      </h4>
                      <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b', lineHeight: 1.4 }}>
                        {scan.desc}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedScans([scan.id]);
                          handleRunScans([scan.id]);
                        }}
                        style={{
                          marginTop: '14px',
                          width: '100%',
                          padding: '8px',
                          borderRadius: '8px',
                          border: '1.5px solid #0f4c5c',
                          background: 'none',
                          color: '#0f4c5c',
                          fontWeight: 'bold',
                          fontSize: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.15s'
                        }}
                      >
                        Run Scan
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Primary Run Scans Button */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleRunScans(selectedScans)}
                  disabled={selectedScans.length === 0}
                  style={{
                    padding: '12px 32px',
                    borderRadius: '10px',
                    background: selectedScans.length > 0 ? 'linear-gradient(135deg, #0f4c5c, #065f46)' : '#cbd5e1',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    cursor: selectedScans.length > 0 ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s'
                  }}
                >
                  Run Selected Scans ({selectedScans.length})
                </button>
              </div>
            </div>
          ) : (
            // PHASE 2: RESULTS SCREEN
            <div>
              {/* Toolbar */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#ffffff',
                border: '1.5px solid #e2e8f0',
                borderRadius: '16px',
                padding: '12px 16px',
                marginBottom: '20px'
              }}>
                <button
                  type="button"
                  onClick={() => setScanPhase(1)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0f4c5c',
                    fontWeight: 'bold',
                    fontSize: '13.5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  &larr; Back to Scan Selector
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleRunScans(selectedScans)}
                    disabled={scanning}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: '1.5px solid #e2e8f0',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 'bold',
                      fontSize: '12.5px',
                      cursor: scanning ? 'not-allowed' : 'pointer'
                    }}
                  >
                    🔄 Re-run Scan
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPDF}
                    disabled={scanResults.length === 0}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: scanResults.length > 0 ? 'linear-gradient(135deg, #0f4c5c, #065f46)' : '#cbd5e1',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      fontSize: '12.5px',
                      cursor: scanResults.length > 0 ? 'pointer' : 'not-allowed'
                    }}
                  >
                    📄 Export as PDF
                  </button>
                </div>
              </div>

              {/* Status Header */}
              <div style={{
                backgroundColor: scanning ? '#eff6ff' : '#f0fdf4',
                border: scanning ? '1px solid #bfdbfe' : '1px solid #bbf7d0',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '13.5px',
                color: scanning ? '#1e3a8a' : '#15803d',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                {scanning && (
                  <svg className="animate-spin" style={{ width: '16px', height: '16px' }} viewBox="0 0 24 24" fill="none">
                    <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                <span>{scanStatus}</span>
              </div>

              {/* Real-time SSE Results List */}
              {scanResults.length === 0 && scanning ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>🤖</div>
                  <h4 style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#0f172a' }}>AI Diagnostics in Progress</h4>
                  <p style={{ margin: 0, fontSize: '13px' }}>Generating smart forecasts based on 90-day issue history...</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {scanResults.map((scanGroup) => (
                    <div key={scanGroup.scan_type} style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '16px',
                      padding: '16px',
                      border: '1.5px solid #e2e8f0'
                    }}>
                      <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        🔍 {scanGroup.scan_type.replace('_', ' ')} scan results
                      </h4>

                      {(!scanGroup.results || scanGroup.results.length === 0) ? (
                        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>No risk areas detected for this category.</p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {scanGroup.results.map((item, idx) => {
                            const riskColors = {
                              Critical: { text: '#dc2626', bg: '#fef2f2', border: '#fecaca', arrow: '▲' },
                              High: { text: '#ea580c', bg: '#fffedd', border: '#ffedd5', arrow: '▲' },
                              Medium: { text: '#ca8a04', bg: '#fef9c3', border: '#fef08a', arrow: '●' },
                              Low: { text: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', arrow: '▼' }
                            };
                            const style = riskColors[item.risk_level] || riskColors.Low;
                            return (
                              <div
                                key={idx}
                                style={{
                                  backgroundColor: '#ffffff',
                                  border: '1.5px solid #e2e8f0',
                                  borderRadius: '12px',
                                  padding: '14px',
                                  borderLeft: `5px solid ${style.text}`,
                                  display: 'flex',
                                  gap: '12px'
                                }}
                              >
                                <div style={{ fontSize: '20px', display: 'flex', alignItems: 'center', color: style.text, fontWeight: 'bold' }}>
                                  {style.arrow}
                                </div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#0f172a' }}>{item.ward_name}</span>
                                    <span style={{
                                      fontSize: '11px',
                                      fontWeight: '800',
                                      color: style.text,
                                      backgroundColor: style.bg,
                                      border: `1px solid ${style.border}`,
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      textTransform: 'uppercase'
                                    }}>
                                      {item.risk_level} Risk
                                    </span>
                                  </div>
                                  <p style={{ margin: '0 0 6px 0', fontSize: '13.5px', color: '#334155', fontWeight: '500' }}>
                                    <strong>Recommendation:</strong> {item.recommended_action}
                                  </p>
                                  {item.reasoning && (
                                    <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: '#64748b', lineHeight: 1.4 }}>
                                      {item.reasoning}
                                    </p>
                                  )}
                                  <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#475569', fontWeight: 'bold', borderTop: '1px solid #f1f5f9', paddingTop: '8px' }}>
                                    <span>🎯 Category: {item.category || item.predicted_issue_category}</span>
                                    <span>⏱️ Timeframe: {item.predicted_timeframe || item.timeframe}</span>
                                    <span>📈 Confidence: {item.confidence_percent || item.confidence}%</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT: LEADERBOARD (WARD & DEPARTMENTS) */}
      {activeTab === 'leaderboard' && (
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#475569', margin: '0 0 10px 0', textTransform: 'uppercase' }}>
            🏢 Department Accountability Scores
          </h3>
          
          <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden', marginBottom: '24px' }}>
            {deptLeaderboard.map((item, index) => {
              const rank = index + 1;
              const trophy = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : `#${rank}`));
              return (
                <div key={item.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderBottom: index < deptLeaderboard.length - 1 ? '1px solid #e2e8f0' : 'none',
                  backgroundColor: item.accountability_score < 40 ? '#fef2f2' : '#ffffff'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '16px', fontWeight: '800', width: '24px' }}>{trophy}</span>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: 'bold' }}>{item.name}</h4>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>
                        Head: {item.head_name} | Assigned: {item.issues_assigned} (Resolved: {item.issues_resolved})
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: '800',
                      color: item.accountability_score >= 50 ? '#16a34a' : '#b91c1c'
                    }}>
                      {item.accountability_score}/100
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#475569', margin: '0 0 10px 0', textTransform: 'uppercase' }}>
            📍 Ward Resolution Leaderboard
          </h3>

          {wardLeaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', backgroundColor: '#ffffff', borderRadius: '16px', color: '#64748b' }}>
              No ward data available.
            </div>
          ) : (
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', border: '1.5px solid #e2e8f0', overflow: 'hidden' }}>
              {wardLeaderboard.map((item, index) => {
                const rank = index + 1;
                const trophy = rank === 1 ? '🥇' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : `#${rank}`));
                
                return (
                  <div key={item.ward} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px',
                    borderBottom: index < wardLeaderboard.length - 1 ? '1px solid #e2e8f0' : 'none',
                    backgroundColor: rank === 1 ? '#fffbeb' : '#ffffff'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: rank <= 3 ? '22px' : '14px', fontWeight: '800', width: '32px' }}>
                        {trophy}
                      </span>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 'bold' }}>{item.ward}</h4>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          Resolved {item.resolved_count} out of {item.total_count} total issues
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: '900', color: '#16a34a' }}>
                        {Math.round(item.resolution_rate * 100)}%
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 'bold' }}>RES. RATE</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ASSIGNING DIALOG MODAL */}
      {assigningIssue && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold' }}>Assign to department</h3>
            <form onSubmit={handleAssignSubmit}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '6px' }}>
                  CHOOSE DEPARTMENT CREW
                </label>
                <select
                  value={assigneeDept}
                  onChange={(e) => setAssigneeDept(e.target.value)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '13.5px' }}
                >
                  <option value="Roads & Highways Department">Roads & Highways Department</option>
                  <option value="Water Supply & Sewerage Board">Water Supply & Sewerage Board</option>
                  <option value="Electricity & Lighting Corporation">Electricity & Lighting Corporation</option>
                  <option value="Solid Waste Management Dept">Solid Waste Management Dept</option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '6px' }}>
                  SLA RESOLUTION ETA (DAYS)
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={etaDays}
                  onChange={(e) => setEtaDays(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '13.5px' }}
                />
              </div>
              
              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button type="submit" disabled={actionLoading} style={{ flex: 1, padding: '10px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                  {actionLoading ? 'Assigning...' : 'Assign'}
                </button>
                <button type="button" onClick={() => setAssigningIssue(null)} style={{ flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESOLVING DIALOG MODAL */}
      {resolvingIssue && (
        <div style={modalOverlay}>
          <div style={modalContent}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 'bold' }}>Resolve civic issue</h3>
            <form onSubmit={handleResolveSubmit}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) {
                    setProofImage(file);
                    setProofPreview(URL.createObjectURL(file));
                  }
                }}
                style={{ display: 'block', marginBottom: '14px', fontSize: '12px' }}
              />

              {proofPreview && (
                <div style={{ marginBottom: '14px', textAlign: 'center' }}>
                  <img src={proofPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '120px', borderRadius: '8px', objectFit: 'cover' }} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const byteString = atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                      ia[i] = byteString.charCodeAt(i);
                    }
                    const blob = new Blob([ab], { type: "image/gif" });
                    const file = new File([blob], "resolved_mock.gif", { type: "image/gif" });
                    setProofImage(file);
                    setProofPreview("https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=400&q=80");
                  }}
                  style={{
                    padding: '8px',
                    backgroundColor: '#f0fdf4',
                    color: '#16a34a',
                    border: '1.5px dashed #16a34a',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    cursor: 'pointer',
                    marginBottom: '10px'
                  }}
                >
                  💡 Use Mock Resolved Photo
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" disabled={actionLoading || !proofImage} style={{ flex: 1, padding: '10px', backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer', opacity: (!proofImage || actionLoading) ? 0.6 : 1 }}>
                    {actionLoading ? 'Resolving...' : 'Confirm'}
                  </button>
                  <button type="button" onClick={() => { setResolvingIssue(null); setProofImage(null); setProofPreview(null); }} style={{ flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DAILY BRIEFING 7-DAY ARCHIVE MODAL */}
      {showBriefingsModal && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '800', textAlign: 'center' }}>
              📜 7-Day Morning Briefings Archive
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {prevBriefings.length === 0 ? (
                <p style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>No previous briefings archived.</p>
              ) : (
                prevBriefings.map((b) => (
                  <div key={b.id} style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '12px',
                    padding: '12px 14px'
                  }}>
                    <strong style={{ fontSize: '13px', color: '#6d28d9', display: 'block', marginBottom: '6px' }}>
                      📅 Briefing for {b.date}
                    </strong>
                    <p style={{ margin: 0, fontSize: '12.5px', color: '#334155', lineHeight: '1.45', whiteSpace: 'pre-line' }}>
                      {b.content}
                    </p>
                  </div>
                ))
              )}
            </div>
            
            <button
              onClick={() => setShowBriefingsModal(false)}
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '10px',
                backgroundColor: '#1e293b',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
