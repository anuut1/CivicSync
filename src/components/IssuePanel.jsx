import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { voteIssue, API_URL } from '../api/client';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import axios from 'axios';
import html2canvas from 'html2canvas';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

const categoryEmojis = {
  pothole: '🕳️',
  water_leak: '💧',
  broken_light: '💡',
  waste: '🗑️',
  other: '⚠️'
};

const getSeverityDetails = (severity) => {
  const s = Number(severity);
  if (s === 1) return { label: 'Minor', color: '#22c55e' };
  if (s === 2) return { label: 'Moderate', color: '#84cc16' };
  if (s === 3) return { label: 'Significant', color: '#f59e0b' };
  if (s === 4) return { label: 'Severe', color: '#f97316' };
  return { label: 'Critical', color: '#ef4444' };
};

const getMarkerColor = (issue) => {
  if (!issue) return '#f97316';
  if (Number(issue.severity) === 4) return '#ef4444';
  const status = issue.status?.toLowerCase();
  if (status === 'resolved') return '#22c55e';
  if (status === 'verified' || status === 'assigned') return '#2563eb';
  return '#f97316';
};

const timeAgo = (dateStr) => {
  if (!dateStr) return "recently";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) {
    const diffMins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  }
  if (diffHours >= 24) {
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
  return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
};

const formatTime = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

function IssuePanel() {
  const { selectedIssue, selectIssue, updateIssue, user, setToast } = useStore();
  
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState('');
  const [copied, setCopied] = useState(false);

  // Timeline & Comments States
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Departments Lookup
  const [departments, setDepartments] = useState([]);

  // Poster Modal States
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Rating and Escalation states
  const [submittingRating, setSubmittingRating] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [ratingHover, setRatingHover] = useState(0);

  // Admin action states
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [showCheckupModal, setShowCheckupModal] = useState(false);
  
  const [assigneeDept, setAssigneeDept] = useState('Roads & Highways Department');
  const [inspectorDept, setInspectorDept] = useState('Civic Inspector Squad A');
  const [proofImage, setProofImage] = useState(null);
  const [proofPreview, setProofPreview] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [etaDays, setEtaDays] = useState(3);

  // Load timeline events and department details on issue change
  const fetchTimelineEvents = async () => {
    if (!selectedIssue?.id) return;
    setLoadingEvents(true);
    try {
      const res = await axios.get(`${API_URL}/api/issues/${selectedIssue.id}/events`);
      setEvents(res.data);
    } catch (err) {
      console.error("Timeline query error:", err);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    fetchTimelineEvents();
    
    // Fetch departments
    axios.get(`${API_URL}/api/public/departments`)
      .then(res => setDepartments(res.data))
      .catch(err => console.error("Error loading departments list:", err));

    setVoteError('');
    setCopied(false);
    setShowAssignModal(false);
    setShowResolveModal(false);
    setShowCheckupModal(false);
    setProofImage(null);
    setProofPreview(null);
  }, [selectedIssue?.id]);

  if (!selectedIssue) return null;

  const isResolved = selectedIssue.status === 'resolved';

  const verifiersList = (() => {
    try {
      return typeof selectedIssue.verifiers === 'string'
        ? JSON.parse(selectedIssue.verifiers || '[]')
        : (selectedIssue.verifiers || []);
    } catch {
      return [];
    }
  })();

  const statusSteps = ['pending', 'verified', 'assigned', 'resolved'];
  const currentStepIndex = statusSteps.indexOf(selectedIssue.status?.toLowerCase() || 'pending');

  const getDefaultCrew = (category) => {
    if (category === 'pothole') return 'Roads & Highways Department';
    if (category === 'water_leak') return 'Water Supply & Sewerage Board';
    if (category === 'broken_light') return 'Electricity & Lighting Corporation';
    if (category === 'waste') return 'Solid Waste Management Dept';
    return 'Roads & Highways Department';
  };

  // Lookup matched department details
  const matchedDept = departments.find(
    d => d.id === selectedIssue.assigned_department_id || d.name === selectedIssue.assigned_to
  );

  // Compute SLA Countdown
  const getSLADetails = () => {
    const slaConfig = {
      pothole: 168,
      water_leak: 24,
      broken_light: 72,
      waste: 48,
      other: 120
    };
    const hoursLimit = slaConfig[selectedIssue.category] || 120;
    const createdTime = new Date(selectedIssue.created_at).getTime();
    const targetTime = createdTime + hoursLimit * 60 * 60 * 1000;
    const now = Date.now();
    const isOverdue = now > targetTime;
    const timeDiff = Math.abs(targetTime - now);
    
    const diffHours = Math.floor(timeDiff / (1000 * 60 * 60));
    const diffMins = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      isOverdue,
      targetTime: new Date(targetTime),
      countdownStr: isOverdue 
        ? `${diffHours}h ${diffMins}m overdue`
        : `${diffHours}h ${diffMins}m remaining`,
      limitDays: hoursLimit / 24
    };
  };

  const sla = getSLADetails();

  const handleVote = async () => {
    setVoting(true);
    setVoteError('');
    try {
      const response = await voteIssue(selectedIssue.id);
      const updatedIssue = {
        ...selectedIssue,
        vote_count: response.data.vote_count,
        status: response.data.status
      };
      
      updateIssue(updatedIssue);
      fetchTimelineEvents(); // reload events
      
      const currentUser = useStore.getState().user;
      if (currentUser) {
        const updatedUser = { ...currentUser, xp: response.data.user_xp };
        localStorage.setItem('civisync_user', JSON.stringify(updatedUser));
        useStore.setState({ user: updatedUser });
      }
    } catch (err) {
      console.error(err);
      if (err.response?.status === 400) {
        setVoteError('You have already verifying-voted for this issue.');
      } else {
        setVoteError('Failed to upvote.');
      }
    } finally {
      setVoting(false);
    }
  };

  const handleAssignSubmit = async (e) => {
    if (e) e.preventDefault();
    setActionLoading(true);
    try {
      const token = localStorage.getItem('civisync_token');
      const response = await axios.post(
        `${API_URL}/api/issues/${selectedIssue.id}/assign`,
        { assigned_to: assigneeDept, eta_days: Number(etaDays) },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      updateIssue(response.data);
      setShowAssignModal(false);
      fetchTimelineEvents();
      if (setToast) setToast({ message: `Successfully assigned to ${assigneeDept}!`, type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Assignment failed.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!proofImage) return;
    setActionLoading(true);
    try {
      const token = localStorage.getItem('civisync_token');
      const formData = new FormData();
      formData.append('resolved_image', proofImage);
      const response = await axios.post(
        `${API_URL}/api/issues/${selectedIssue.id}/resolve`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } }
      );
      updateIssue(response.data.issue);
      setShowResolveModal(false);
      setProofImage(null);
      setProofPreview(null);
      fetchTimelineEvents();
      if (setToast) setToast({ message: 'Issue resolved & scored by AI!', type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Resolution failed.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const token = localStorage.getItem('civisync_token');
      await axios.post(
        `${API_URL}/api/issues/${selectedIssue.id}/comment`,
        { text: commentText },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setCommentText('');
      fetchTimelineEvents();
      if (setToast) setToast({ message: 'Comment added to timeline!', type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Failed to post comment.', type: 'error' });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleRateSubmit = async (stars) => {
    setSubmittingRating(true);
    try {
      const token = localStorage.getItem('civisync_token');
      await axios.post(
        `${API_URL}/api/issues/${selectedIssue.id}/rate`,
        { rating: stars },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      updateIssue({ ...selectedIssue, resolution_rating: stars });
      fetchTimelineEvents();
      if (setToast) setToast({ message: 'Thank you for rating the resolution!', type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Failed to submit rating.', type: 'error' });
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const token = localStorage.getItem('civisync_token');
      await axios.post(
        `${API_URL}/api/issues/${selectedIssue.id}/escalate`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      fetchTimelineEvents();
      if (setToast) setToast({ message: 'Escalation email sent to Ward Councillor!', type: 'success' });
    } catch (err) {
      console.error(err);
      if (setToast) setToast({ message: 'Failed to escalate.', type: 'error' });
    } finally {
      setEscalating(false);
    }
  };

  // WhatsApp Share with html2canvas PNG generation
  const handleShare = () => {
    const cardElement = document.getElementById('issue-details-card');
    if (!cardElement) return;

    setToast && setToast({ message: 'Generating share card...', type: 'info' });

    html2canvas(cardElement, { useCORS: true, logging: false }).then(canvas => {
      canvas.toBlob(blob => {
        const file = new File([blob], `civisync_issue_${selectedIssue.id}.png`, { type: 'image/png' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: `civiSync Chennai Report #${selectedIssue.id}`,
            text: `Help resolve this ${selectedIssue.category?.replace('_', ' ') || 'other'} hazard!`
          }).catch(err => {
            console.log("Web share skipped, using manual download", err);
            downloadCard(canvas);
          });
        } else {
          downloadCard(canvas);
        }
      });
    }).catch(err => {
      console.error("html2canvas failed:", err);
      // Fallback direct copy link
      const deepLink = `${window.location.origin}/?issue=${selectedIssue.id}`;
      navigator.clipboard.writeText(deepLink).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    });
  };

  const downloadCard = (canvas) => {
    const link = document.createElement('a');
    link.download = `civisync_issue_${selectedIssue.id}.png`;
    link.href = canvas.toDataURL();
    link.click();
    
    // Redirect to WhatsApp
    const deepLink = `${window.location.origin}/?issue=${selectedIssue.id}`;
    const text = encodeURIComponent(`Check out civiSync Report #${selectedIssue.id} (${selectedIssue.category}): ${selectedIssue.ai_summary || selectedIssue.description}. Link: ${deepLink}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  // Generate QR Poster Modal Trigger
  const handleGenerateQR = async () => {
    const prefillUrl = `${window.location.origin}/?prefill=true&lat=${selectedIssue.latitude}&lon=${selectedIssue.longitude}&category=${selectedIssue.category}&address=${encodeURIComponent(selectedIssue.address_string)}`;
    try {
      const dataUrl = await QRCode.toDataURL(prefillUrl, { width: 250, margin: 2 });
      setQrDataUrl(dataUrl);
      setShowQRModal(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadPDF = () => {
    const posterElement = document.getElementById('a5-poster-content');
    if (!posterElement) return;

    html2canvas(posterElement, { scale: 2, useCORS: true }).then(canvas => {
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a5'
      });
      pdf.addImage(imgData, 'PNG', 0, 0, 148, 210);
      pdf.save(`civiSync_A5_Poster_${selectedIssue.id}.pdf`);
    });
  };

  const handleClose = () => {
    selectIssue(null);
  };

  const sev = getSeverityDetails(selectedIssue.severity);

  // Timeline event badge colors
  const getTimelineColorStyle = (role) => {
    const r = role.toLowerCase();
    if (r === 'citizen') return { dot: '#22c55e', badge: '#dcfce7', text: '#15803d' };
    if (r === 'admin') return { dot: '#f97316', badge: '#ffedd5', text: '#c2410c' };
    if (r === 'ai') return { dot: '#a855f7', badge: '#f3e8ff', text: '#7e22ce' };
    return { dot: '#64748b', badge: '#f1f5f9', text: '#475569' };
  };

  // Overlay sheet Styles
  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    zIndex: 990,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    backdropFilter: 'blur(3px)',
  };

  const sheetStyle = {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: '435px',
    borderRadius: '24px 24px 0 0',
    boxSizing: 'border-box',
    position: 'relative',
    maxHeight: '92vh',
    overflowY: 'auto',
    boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const imageHeaderStyle = {
    width: '100%',
    height: '180px',
    objectFit: 'cover',
    display: 'block',
  };

  const bodyStyle = {
    padding: '20px',
    boxSizing: 'border-box',
  };

  const badgeStyle = (bgColor, textColor = '#ffffff') => ({
    fontSize: '12px',
    fontWeight: '700',
    padding: '6px 12px',
    borderRadius: '20px',
    backgroundColor: bgColor,
    color: textColor,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    border: '1px solid transparent',
  });

  const progressBarContainer = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '20px 0',
    position: 'relative',
    padding: '0 8px',
  };

  const progressLine = (filled) => ({
    flex: 1,
    height: '4px',
    backgroundColor: filled ? '#16a34a' : '#e2e8f0',
    transition: 'background-color 0.3s',
  });

  const progressNode = (active, label) => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    zIndex: 2,
    position: 'relative',
  });

  const progressDot = (active) => ({
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: active ? '#16a34a' : '#ffffff',
    border: `3px solid ${active ? '#dcfce7' : '#cbd5e1'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s',
  });

  const progressLabelStyle = (active) => ({
    fontSize: '11px',
    fontWeight: '800',
    color: active ? '#16a34a' : '#64748b',
    marginTop: '6px',
    textTransform: 'capitalize',
  });

  const modalOverlay = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(2px)',
  };

  const modalContent = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px',
    width: '90%',
    maxWidth: '380px',
    boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
    boxSizing: 'border-box',
  };

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div style={sheetStyle} id="issue-details-card">
        {/* Close Panel Button */}
        <button
          onClick={handleClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            border: 'none',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            color: '#ffffff',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            backdropFilter: 'blur(3px)',
          }}
        >
          &times;
        </button>

        {/* Side-by-side Before/After Photos for Resolved */}
        {isResolved && selectedIssue.resolved_image_url ? (
          <div style={{ display: 'flex', width: '100%', height: '180px', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <img src={selectedIssue.image_url} alt="Before" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(15, 23, 42, 0.7)', color: '#ffffff', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }}>BEFORE</div>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <img src={selectedIssue.resolved_image_url} alt="After" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(22, 163, 74, 0.8)', color: '#ffffff', padding: '4px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }}>AFTER (RESOLVED)</div>
            </div>
          </div>
        ) : (
          selectedIssue.image_url && (
            <img src={selectedIssue.image_url} alt="Civic Issue" style={imageHeaderStyle} />
          )
        )}

        <div style={bodyStyle}>
          {/* Category Badge & Severity Pill */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <span style={badgeStyle('#f1f5f9', '#334155')}>
               {categoryEmojis[selectedIssue.category] || '⚠️'} {selectedIssue.category?.replace('_', ' ') || 'other'}
            </span>
            <span style={badgeStyle(sev.color)}>{sev.label}</span>
            <span style={badgeStyle('#dbeafe', '#1e40af')}>📍 {selectedIssue.ward}</span>
          </div>

          <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: '800', color: '#0f172a', lineHeight: '1.4' }}>
            {selectedIssue.ai_summary || selectedIssue.description || 'Civic Hazard'}
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
            Reported {timeAgo(selectedIssue.created_at)} by <strong>{selectedIssue.reporter_name || 'Anonymous Citizen'}</strong>
          </p>

          {/* SLA Countdown Display (Countdown Banner) */}
          {selectedIssue.status !== 'resolved' && (
            <div style={{
              backgroundColor: sla.isOverdue ? '#fef2f2' : '#f0fdf4',
              border: `1px solid ${sla.isOverdue ? '#fca5a5' : '#86efac'}`,
              color: sla.isOverdue ? '#b91c1c' : '#166534',
              borderRadius: '12px',
              padding: '12px 14px',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: '700'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⏱️</span>
                <span>
                  SLA Committed fix time: {sla.limitDays} days
                  <br />
                  <span style={{ fontSize: '11px', fontWeight: 'normal', opacity: 0.85 }}>
                    Target: {formatTime(sla.targetTime)}
                  </span>
                </span>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                <span className={sla.isOverdue ? 'pulsing-marker' : ''} style={{ fontSize: '13.5px', textTransform: 'uppercase' }}>
                  {sla.countdownStr}
                </span>
                {sla.isOverdue && (
                  <button
                    onClick={handleEscalate}
                    disabled={escalating}
                    style={{
                      backgroundColor: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '10.5px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      transition: 'opacity 0.2s'
                    }}
                  >
                    {escalating ? 'Escalating...' : 'Escalate to Councillor'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 4-Step Progress Tracker */}
          <div style={progressBarContainer}>
            {statusSteps.map((stepName, index) => {
              const active = index <= currentStepIndex;
              return (
                <React.Fragment key={stepName}>
                  <div style={progressNode(active, stepName)}>
                    <div style={progressDot(active)} />
                    <span style={progressLabelStyle(active)}>{stepName}</span>
                  </div>
                  {index < statusSteps.length - 1 && (
                    <div style={progressLine(index < currentStepIndex)} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Assigned Department Accountability Card */}
          {selectedIssue.assigned_to && (
            <div style={{
              backgroundColor: '#f8fafc',
              border: '1.5px solid #e2e8f0',
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '16px',
              fontSize: '13px',
              color: '#334155'
            }}>
              <div style={{ display: 'flex', justifyContext: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <strong style={{ fontSize: '14px', color: '#1e293b' }}>🛡️ Department Assigned</strong>
                {matchedDept && (
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    backgroundColor: matchedDept.accountability_score >= 50 ? '#dcfce7' : '#fee2e2',
                    color: matchedDept.accountability_score >= 50 ? '#166534' : '#991b1b',
                    padding: '3px 8px',
                    borderRadius: '8px'
                  }}>
                    Score: {matchedDept.accountability_score}/100
                  </span>
                )}
              </div>
              <span style={{ color: '#0f172a', fontWeight: 'bold' }}>{selectedIssue.assigned_to}</span>
              {matchedDept && (
                <div style={{ fontSize: '12px', marginTop: '6px', color: '#64748b' }}>
                  <span>Head: {matchedDept.head_name} </span>
                  <span style={{ marginLeft: '12px' }}>Email: {matchedDept.contact_email}</span>
                </div>
              )}
            </div>
          )}

          {/* Budget Estimator details (Collapsible) */}
          {selectedIssue.cost_max !== null && (
            <details style={{
              border: '1px solid #cbd5e1',
              borderRadius: '12px',
              padding: '10px 14px',
              backgroundColor: '#f8fafc',
              marginBottom: '16px',
              cursor: 'pointer'
            }}>
              <summary style={{ fontWeight: 'bold', fontSize: '13.5px', color: '#1e293b', outline: 'none' }}>
                🧮 Estimated Repair Cost & Scope
              </summary>
              <div style={{ marginTop: '10px', fontSize: '12.5px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
                  <span>Estimated Cost Range</span>
                  <strong style={{ color: '#15803d' }}>₹{selectedIssue.cost_min?.toLocaleString()} - ₹{selectedIssue.cost_max?.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
                  <span>Repair Method</span>
                  <strong>{selectedIssue.repair_method || 'Standard repaving'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px' }}>
                  <span>Crew Size Requirement</span>
                  <strong>{selectedIssue.crew_size} workers</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Estimated Duration</span>
                  <strong>{selectedIssue.estimated_hours} hours</strong>
                </div>
              </div>
            </details>
          )}

          {/* Before/After Scorer quality feedback */}
          {selectedIssue.ai_repair_score !== null && (
            <div style={{
              backgroundColor: selectedIssue.needs_review ? '#fef2f2' : '#f0fdf4',
              border: `1.5px solid ${selectedIssue.needs_review ? '#fca5a5' : '#bbf7d0'}`,
              borderRadius: '12px',
              padding: '14px',
              marginBottom: '16px',
              fontSize: '13px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ color: selectedIssue.needs_review ? '#b91c1c' : '#15803d' }}>
                  🤖 Before/After AI Repair Scorer
                </strong>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 'bold',
                  backgroundColor: selectedIssue.needs_review ? '#fee2e2' : '#dcfce7',
                  color: selectedIssue.needs_review ? '#b91c1c' : '#15803d',
                  padding: '3px 10px',
                  borderRadius: '10px'
                }}>
                  {selectedIssue.ai_repair_score}/10 ({selectedIssue.ai_repair_verdict})
                </span>
              </div>
              {selectedIssue.ai_remaining_issues && (
                <div style={{ color: '#4b5563', fontSize: '12px' }}>
                  <strong>Remaining Issues:</strong> {selectedIssue.ai_remaining_issues}
                </div>
              )}
              {selectedIssue.needs_review && (
                <div style={{ color: '#b91c1c', fontSize: '11px', marginTop: '6px', fontWeight: 'bold' }}>
                  ⚠️ Supervisor Review Needed: Low Repair Quality Flagged
                </div>
              )}
            </div>
          )}

          {/* Address & Mini Leaflet Map */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#475569', fontWeight: '600', marginBottom: '8px' }}>
              <span>📍 {selectedIssue.address_string || 'Unknown Location'}</span>
            </div>
            
            <div style={{ height: '110px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0', position: 'relative' }}>
              <MapContainer
                center={[parseFloat(selectedIssue.latitude), parseFloat(selectedIssue.longitude)]}
                zoom={14}
                zoomControl={false}
                style={{ height: '100%', width: '100%', pointerEvents: 'none' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <CircleMarker
                  center={[parseFloat(selectedIssue.latitude), parseFloat(selectedIssue.longitude)]}
                  radius={10}
                  pathOptions={{
                    color: getMarkerColor(selectedIssue),
                    fillColor: getMarkerColor(selectedIssue),
                    fillOpacity: 0.8,
                    weight: 2
                  }}
                />
              </MapContainer>
              
              {/* Google Maps / Street View trigger button */}
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selectedIssue.latitude},${selectedIssue.longitude}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.95)',
                  color: '#1e293b',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  border: '1px solid #cbd5e1',
                  textDecoration: 'none',
                  zIndex: 400,
                  boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                }}
              >
                🎥 Open Street View
              </a>
            </div>
          </div>

          {/* Verifiers Avatars Row */}
          {verifiersList.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
              <div style={{ display: 'flex' }}>
                {verifiersList.map((name, index) => {
                  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6'];
                  const color = colors[index % colors.length];
                  return (
                    <div
                      key={index}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: color,
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        fontWeight: 'bold',
                        border: '2px solid #ffffff',
                        marginLeft: index > 0 ? '-8px' : '0',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      }}
                      title={name}
                    >
                      {initials}
                    </div>
                  );
                })}
              </div>
              <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: '600' }}>
                Verified by {verifiersList.length} citizen{verifiersList.length > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Timeline Events Chronological List (Feature 1) */}
          <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '800', color: '#1e293b' }}>
              📋 Activity & Resolution Timeline
            </h4>
            
            {loadingEvents ? (
              <p style={{ fontSize: '12px', color: '#64748b', textAlign: 'center' }}>Loading timeline events...</p>
            ) : (
              <div style={{ position: 'relative', paddingLeft: '14px', borderLeft: '2px solid #e2e8f0', marginLeft: '8px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {events.map((evt) => {
                  const style = getTimelineColorStyle(evt.actor_role);
                  return (
                    <div key={evt.id} style={{ position: 'relative', fontSize: '13px' }}>
                      {/* Timeline dot */}
                      <span style={{
                        position: 'absolute',
                        left: '-19px',
                        top: '4px',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: style.dot,
                        boxShadow: `0 0 0 4px ${evt.event_type === 'ai_summary' ? '#f3e8ff' : '#ffffff'}`
                      }} />
                      
                      {/* Heading */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '2px' }}>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 'bold',
                          padding: '2px 6px',
                          borderRadius: '6px',
                          backgroundColor: style.badge,
                          color: style.text,
                          textTransform: 'uppercase'
                        }}>
                          {evt.actor_role}
                        </span>
                        <strong style={{ color: '#0f172a', fontSize: '12.5px' }}>{evt.actor_name}</strong>
                        <span style={{ fontSize: '10.5px', color: '#94a3b8', marginLeft: 'auto' }}>
                          {timeAgo(evt.created_at)}
                        </span>
                      </div>
                      
                      {/* Content */}
                      <div style={{
                        color: evt.event_type === 'ai_summary' ? '#6b21a8' : '#4b5563',
                        fontWeight: evt.event_type === 'ai_summary' ? 'bold' : 'normal',
                        backgroundColor: evt.event_type === 'ai_summary' ? '#faf5ff' : 'transparent',
                        padding: evt.event_type === 'ai_summary' ? '8px 12px' : '0',
                        borderRadius: '8px',
                        marginTop: '4px'
                      }}>
                        {evt.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Comment Area Box */}
            {user && (
              <form onSubmit={handleCommentSubmit} style={{ marginTop: '20px', display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  placeholder="Post coordination comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1.5px solid #cbd5e1',
                    fontSize: '12.5px',
                    outline: 'none'
                  }}
                  disabled={submittingComment}
                />
                <button
                  type="submit"
                  disabled={submittingComment}
                  style={{
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0 14px',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  {submittingComment ? 'Sending...' : 'Send'}
                </button>
              </form>
            )}
          </div>

          {/* Citizen Rating Form for Resolved status */}
          {isResolved && user?.role === 'citizen' && !selectedIssue.resolution_rating && (
            <div style={{
              marginTop: '20px',
              borderTop: '1px solid #e2e8f0',
              paddingTop: '16px',
              textAlign: 'center'
            }}>
              <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block', marginBottom: '8px' }}>
                ⭐ Rate this Civic Resolution
              </strong>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    disabled={submittingRating}
                    onMouseEnter={() => setRatingHover(star)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => handleRateSubmit(star)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '26px',
                      cursor: 'pointer',
                      color: star <= (ratingHover || selectedIssue.resolution_rating || 0) ? '#eab308' : '#e2e8f0',
                      transition: 'transform 0.1s'
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions Buttons Grid */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
            {selectedIssue.status !== 'resolved' ? (
              user?.role?.toLowerCase() === 'admin' ? (
                <div style={{ display: 'flex', gap: '8px', flex: 3 }}>
                  <button
                    onClick={() => {
                      setAssigneeDept(getDefaultCrew(selectedIssue.category));
                      setShowAssignModal(true);
                    }}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontWeight: 'bold',
                      fontSize: '13.5px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
                    }}
                  >
                    Assign
                  </button>
                  <button
                    onClick={() => setShowResolveModal(true)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: '#16a34a',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontWeight: 'bold',
                      fontSize: '13.5px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)'
                    }}
                  >
                    Resolve
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleVote}
                  disabled={voting}
                  style={{
                    flex: 3,
                    padding: '14px',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 'bold',
                    fontSize: '14.5px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  className="upvote-scale-animation"
                >
                  <span>👍</span>
                  <span>Verify hazard ({selectedIssue.vote_count})</span>
                </button>
              )
            ) : (
              <div style={{
                flex: 3,
                padding: '14px',
                backgroundColor: '#dcfce7',
                color: '#15803d',
                borderRadius: '12px',
                fontWeight: 'bold',
                fontSize: '14.5px',
                textAlign: 'center',
                border: '1.5px solid #bbf7d0',
              }}>
                ✓ Community Resolved
              </div>
            )}
            
            {/* Share to WhatsApp & QR code generator */}
            <button
              onClick={handleShare}
              style={{
                flex: 1,
                padding: '14px',
                backgroundColor: '#f1f5f9',
                color: '#475569',
                border: 'none',
                borderRadius: '12px',
                fontWeight: 'bold',
                fontSize: '13.5px',
                cursor: 'pointer',
              }}
            >
              {copied ? 'Copied! 🔗' : 'Share 🔗'}
            </button>

            <button
              onClick={handleGenerateQR}
              style={{
                padding: '14px',
                backgroundColor: '#f8fafc',
                color: '#1e293b',
                border: '1.5px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '16px',
                cursor: 'pointer',
              }}
              title="Print QR poster"
            >
              🖨️
            </button>
          </div>

          {voteError && (
            <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: 'bold', marginTop: '10px', textAlign: 'center' }}>
              ⚠️ {voteError}
            </div>
          )}
        </div>

        {/* Assign Modal */}
        {showAssignModal && (
          <div style={modalOverlay}>
            <div style={modalContent}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '17px', fontWeight: '800', color: '#1e293b' }}>Assign Department Crew</h3>
              <form onSubmit={handleAssignSubmit}>
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>
                    Choose Department Crew
                  </label>
                  <select
                    value={assigneeDept}
                    onChange={(e) => setAssigneeDept(e.target.value)}
                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="Roads & Highways Department">Roads & Highways Department</option>
                    <option value="Water Supply & Sewerage Board">Water Supply & Sewerage Board</option>
                    <option value="Electricity & Lighting Corporation">Electricity & Lighting Corporation</option>
                    <option value="Solid Waste Management Dept">Solid Waste Management Dept</option>
                  </select>
                </div>
                
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>
                    SLA Commitment ETA (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    value={etaDays}
                    onChange={(e) => setEtaDays(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>
                
                <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                  <button type="submit" disabled={actionLoading} style={{ flex: 1, padding: '10px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                    {actionLoading ? 'Assigning...' : 'Assign'}
                  </button>
                  <button type="button" onClick={() => setShowAssignModal(false)} style={{ flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Resolve Modal */}
        {showResolveModal && (
          <div style={modalOverlay}>
            <div style={modalContent}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '17px', fontWeight: '800', color: '#1e293b' }}>Resolve Issue</h3>
              <p style={{ margin: '0 0 16px 0', fontSize: '12.5px', color: '#64748b', lineHeight: '1.4' }}>
                Upload a photograph proving this hazard has been successfully repaired/resolved.
              </p>
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
                    onClick={async () => {
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
                      marginBottom: '10px',
                    }}
                  >
                    💡 Use Mock Resolved Photo
                  </button>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" disabled={actionLoading || !proofImage} style={{ flex: 1, padding: '10px', backgroundColor: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer', opacity: (!proofImage || actionLoading) ? 0.6 : 1 }}>
                      {actionLoading ? 'Resolving...' : 'Confirm'}
                    </button>
                    <button type="button" onClick={() => { setShowResolveModal(false); setProofImage(null); setProofPreview(null); }} style={{ flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* QR Code Poster Modal (A5 Template) */}
        {showQRModal && (
          <div style={modalOverlay}>
            <div style={{ ...modalContent, maxWidth: '420px', padding: '18px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '800', color: '#1e293b', textAlign: 'center' }}>
                🖨️ A5 QR Poster Preview
              </h3>
              
              {/* A5 Poster Container */}
              <div
                id="a5-poster-content"
                style={{
                  width: '350px',
                  height: '495px',
                  border: '12px solid #16a34a',
                  boxSizing: 'border-box',
                  padding: '24px 18px',
                  backgroundColor: '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  fontFamily: 'system-ui, sans-serif',
                  margin: '0 auto',
                  color: '#1e293b'
                }}
              >
                <span style={{ fontSize: '32px', marginBottom: '8px' }}>
                  {categoryEmojis[selectedIssue.category] || '⚠️'}
                </span>
                <h2 style={{ fontSize: '17px', fontWeight: '900', color: '#16a34a', textAlign: 'center', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Help Fix Our Ward!
                </h2>
                <p style={{ fontSize: '11px', textAlign: 'center', margin: '0 0 16px 0', color: '#64748b', fontWeight: 'bold' }}>
                  Scan code to verify this issue or report a new civic hazard nearby.
                </p>
                
                {/* QR Image */}
                <div style={{
                  padding: '10px',
                  border: '2px solid #e2e8f0',
                  borderRadius: '12px',
                  backgroundColor: '#ffffff',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <img src={qrDataUrl} alt="QR Poster Code" style={{ width: '150px', height: '150px' }} />
                </div>
                
                {/* Issue Details Box */}
                <div style={{
                  backgroundColor: '#f8fafc',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  width: '100%',
                  boxSizing: 'border-box',
                  fontSize: '11px',
                  color: '#475569',
                  marginBottom: '16px'
                }}>
                  <div style={{ marginBottom: '4px' }}>
                    <strong>Hazard ID:</strong> #{selectedIssue.id} ({selectedIssue.category.toUpperCase()})
                  </div>
                  <div>
                    <strong>Location:</strong> {selectedIssue.address_string}
                  </div>
                </div>
                
                {/* Branding footer */}
                <div style={{ marginTop: 'auto', textAlign: 'center', borderTop: '1px solid #cbd5e1', width: '100%', paddingTop: '8px' }}>
                  <span style={{ fontSize: '9px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase' }}>
                    Powered by civiSync Chennai App
                  </span>
                </div>
              </div>
              
              {/* Controls */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={handleDownloadPDF}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  Download PDF Poster
                </button>
                <button
                  onClick={() => setShowQRModal(false)}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '13px',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default IssuePanel;
