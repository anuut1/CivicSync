import React, { useState, useEffect } from 'react';
import { useStore } from '../utils/store';
import { reportIssue, analyzeIssue } from '../api/client';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const categoryEmojis = {
  pothole: '🕳️',
  water_leak: '💧',
  broken_light: '💡',
  waste: '🗑️',
  other: '⚠️'
};

const categories = ['pothole', 'water_leak', 'broken_light', 'waste', 'other'];
const severities = ['Low', 'Medium', 'High', 'Critical'];

// Map Click Picker Helper Component
function MapClickPicker({ setLatitude, setLongitude, setAddressString }) {
  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng;
      setLatitude(lat);
      setLongitude(lng);
      
      // Reverse geocode to get a nice address string
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const data = await res.json();
        if (data && data.display_name) {
          // Shorten address
          const shortAddress = data.display_name.split(',').slice(0, 3).join(',');
          setAddressString(shortAddress);
        }
      } catch (err) {
        setAddressString(`Pin drop at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      }
    }
  });
  return null;
}

function ReportForm() {
  const { showReportForm, setShowReport, addIssue, selectIssue, mapCenter } = useStore();
  
  // Wizard Steps: 1 = Upload, 2 = AI Verify, 3 = Location, 4 = Success
  const [step, setStep] = useState(1);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  
  // AI Analyzed Fields (Editable)
  const [category, setCategory] = useState('other');
  const [severity, setSeverity] = useState('Medium');
  const [description, setDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);

  // Budget Estimator Fields
  const [costMin, setCostMin] = useState(null);
  const [costMax, setCostMax] = useState(null);
  const [repairMethod, setRepairMethod] = useState('');
  const [estimatedHours, setEstimatedHours] = useState(null);
  const [crewSize, setCrewSize] = useState(null);

  // Location Fields
  const [locationMode, setLocationMode] = useState('gps'); // 'gps' | 'map' | 'address'
  const [latitude, setLatitude] = useState(13.0827);
  const [longitude, setLongitude] = useState(80.2707);
  const [addressString, setAddressString] = useState('Detecting location...');
  const [searchQuery, setSearchQuery] = useState('');
  const [locating, setLocating] = useState(false);

  // Submit and Success States
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Check URL query parameters for prefill info
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('prefill') === 'true') {
      const lat = parseFloat(params.get('lat'));
      const lon = parseFloat(params.get('lon'));
      const cat = params.get('category');
      const addr = params.get('address');
      
      if (!isNaN(lat) && !isNaN(lon)) {
        setLatitude(lat);
        setLongitude(lon);
      }
      if (cat) {
        setCategory(cat);
      }
      if (addr) {
        setAddressString(addr);
      }
      
      // Load preset image if needed for submission
      // To satisfy backend file upload, let's load a mock 1x1 image blob
      const byteString = atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: "image/gif" });
      const file = new File([blob], "prefilled_location.gif", { type: "image/gif" });
      setImageFile(file);
      setImagePreview("https://images.unsplash.com/photo-1599740831119-bab48d6cc8f7?auto=format&fit=crop&w=800&q=80");
      
      setShowReport(true);
      setStep(3); // Jump straight to location confirmation
      
      // Clear URL params
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Synchronize coordinates with map center on mount/open
  useEffect(() => {
    if (showReportForm && mapCenter && !window.location.search.includes('prefill=true')) {
      setLatitude(mapCenter[0]);
      setLongitude(mapCenter[1]);
    }
  }, [showReportForm, mapCenter]);

  if (!showReportForm) return null;

  // Process selected file with Gemini Vision in the background
  const processImageAnalysis = async (file) => {
    setAnalyzing(true);
    setStep(2); // Go to step 2 AI Result Screen immediately
    setError('');

    const formData = new FormData();
    formData.append('image', file);
    formData.append('description', description);

    try {
      const response = await analyzeIssue(formData);
      // Response returns: { category, severity, description }
      const data = response.data;
      setCategory(data.category);
      setSeverity(data.severity);
      setDescription(data.description);
      setCostMin(data.cost_min);
      setCostMax(data.cost_max);
      setRepairMethod(data.repair_method);
      setEstimatedHours(data.estimated_hours);
      setCrewSize(data.crew_size);
    } catch (err) {
      console.error("AI Analysis failed:", err);
      // fallback guess
      const name = file.name.toLowerCase();
      if (name.includes('pothole') || name.includes('road')) setCategory('pothole');
      else if (name.includes('water') || name.includes('leak')) setCategory('water_leak');
      else if (name.includes('light') || name.includes('bulb')) setCategory('broken_light');
      else if (name.includes('trash') || name.includes('waste') || name.includes('garbage')) setCategory('waste');
      setDescription("Civic issue detected.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      processImageAnalysis(file);
    }
  };

  // Preset Mock Images
  const handleLoadMockImage = async (type) => {
    let url = '';
    if (type === 'pothole') {
      url = 'https://images.unsplash.com/photo-1515162305285-0293e4767cc2?auto=format&fit=crop&w=600&q=80';
    } else if (type === 'water_leak') {
      url = 'https://images.unsplash.com/photo-1542013936693-8848e574047e?auto=format&fit=crop&w=600&q=80';
    } else if (type === 'broken_light') {
      url = 'https://images.unsplash.com/photo-1508873535684-277a3cbcc4e8?auto=format&fit=crop&w=600&q=80';
    } else {
      url = 'https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?auto=format&fit=crop&w=600&q=80';
    }

    setAnalyzing(true);
    setStep(2);

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], `${type}_preset.jpg`, { type: 'image/jpeg' });
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      await processImageAnalysis(file);
    } catch (err) {
      console.error(err);
      setError('Failed to load preset image.');
      setAnalyzing(false);
    }
  };

  // Location Step logic
  const handleGPSSetup = () => {
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        setLatitude(lat);
        setLongitude(lon);
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
          const data = await res.json();
          if (data && data.display_name) {
            setAddressString(data.display_name.split(',').slice(0, 3).join(','));
          } else {
            setAddressString(`Chennai, Tamil Nadu`);
          }
        } catch {
          setAddressString("Acquired GPS Coordinates");
        }
        setLocating(false);
      },
      (err) => {
        console.warn(err);
        setAddressString("Chennai Central Station (fallback)");
        setLatitude(13.0827);
        setLongitude(80.2707);
        setError('Location access denied. Please click map or type address.');
        setLocating(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    if (step === 3 && locationMode === 'gps') {
      handleGPSSetup();
    }
  }, [step, locationMode]);

  const handleAddressSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setLocating(true);
    setError('');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setLatitude(lat);
        setLongitude(lon);
        setAddressString(data[0].display_name.split(',').slice(0, 3).join(','));
      } else {
        setError('Address not found. Please type another address.');
      }
    } catch (err) {
      setError('Search failed. Check your network connection.');
    } finally {
      setLocating(false);
    }
  };

  // Submit Final Report
  const handleSubmitReport = async () => {
    setSubmitting(true);
    setError('');

    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('latitude', latitude);
    formData.append('longitude', longitude);
    formData.append('description', description);
    formData.append('address_string', addressString);
    formData.append('category', category);
    formData.append('severity', severity);
    if (costMin !== null) formData.append('cost_min', costMin);
    if (costMax !== null) formData.append('cost_max', costMax);
    if (repairMethod) formData.append('repair_method', repairMethod);
    if (estimatedHours !== null) formData.append('estimated_hours', estimatedHours);
    if (crewSize !== null) formData.append('crew_size', crewSize);

    try {
      const response = await reportIssue(formData);
      // Successful submission
      setSuccessData(response.data);
      addIssue(response.data);
      
      // Update local storage XP and user data if reporter
      const currentUser = useStore.getState().user;
      if (currentUser) {
        // First report gets +25 XP if ward was empty, otherwise +10 XP. Backend does this, we update frontend state.
        // Let's assume +10 XP for standard user update, or fetch updated user.
        const updatedUser = { ...currentUser, xp: currentUser.xp + 10 };
        localStorage.setItem('civisync_user', JSON.stringify(updatedUser));
        useStore.setState({ user: updatedUser });
      }

      setStep(4);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || 'Failed to file issue report.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (successData) {
      selectIssue(successData); // Deep-links to and centers on the new issue
    }
    // Reset wizard
    setStep(1);
    setImageFile(null);
    setImagePreview(null);
    setCategory('other');
    setSeverity('Medium');
    setDescription('');
    setLocationMode('gps');
    setLatitude(13.0827);
    setLongitude(80.2707);
    setAddressString('Detecting location...');
    setSearchQuery('');
    setSuccessData(null);
    setShowConfetti(false);
    setShowReport(false);
  };

  // Styles
  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    backdropFilter: 'blur(3px)',
  };

  const sheetStyle = {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: '430px',
    borderRadius: '24px 24px 0 0',
    boxSizing: 'border-box',
    padding: '24px 20px',
    position: 'relative',
    maxHeight: '92vh',
    overflowY: 'auto',
    boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.12)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };

  const progressHeader = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  };

  const stepDot = (active) => ({
    flex: 1,
    height: '6px',
    borderRadius: '4px',
    backgroundColor: active ? '#16a34a' : '#e5e7eb',
    margin: '0 4px',
    transition: 'background-color 0.2s',
  });

  const titleStyle = {
    margin: '0 0 8px 0',
    fontSize: '20px',
    fontWeight: '800',
    color: '#0f172a',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  };

  const textInputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '10px',
    border: '1.5px solid #e2e8f0',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
    marginBottom: '16px',
  };

  const buttonStyle = (disabled, variant = 'primary') => ({
    width: '100%',
    padding: '14px',
    backgroundColor: variant === 'secondary' ? '#f1f5f9' : (disabled ? '#cbd5e1' : '#16a34a'),
    color: variant === 'secondary' ? '#475569' : '#ffffff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'all 0.2s',
    boxShadow: variant === 'secondary' ? 'none' : (disabled ? 'none' : '0 4px 14px rgba(22, 163, 74, 0.25)'),
    marginTop: '10px',
  });

  const previewBoxStyle = {
    width: '100%',
    height: '180px',
    borderRadius: '16px',
    border: '2px dashed #cbd5e1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: '16px',
    backgroundColor: '#f8fafc',
    position: 'relative',
    cursor: 'pointer',
  };

  const fileInputStyle = {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0,
    cursor: 'pointer',
  };

  const segmentedControl = {
    display: 'flex',
    backgroundColor: '#f1f5f9',
    borderRadius: '10px',
    padding: '4px',
    marginBottom: '16px',
  };

  const segmentBtn = (active) => ({
    flex: 1,
    padding: '8px 4px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    backgroundColor: active ? '#ffffff' : 'transparent',
    color: active ? '#0f172a' : '#64748b',
    boxShadow: active ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
    transition: 'all 0.2s',
  });

  const chipStyle = (active, color) => ({
    padding: '8px 12px',
    borderRadius: '20px',
    border: `1.5px solid ${active ? color : '#e2e8f0'}`,
    backgroundColor: active ? color + '15' : '#ffffff',
    color: active ? color : '#64748b',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  });

  // Confetti CSS Particles
  const confettiArray = Array.from({ length: 60 });

  return (
    <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && handleClose()}>
      {/* Inject Confetti Animations */}
      <style>{`
        @keyframes fall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(90vh) rotate(720deg); opacity: 0; }
        }
        .confetti-particle {
          position: absolute;
          top: -20px;
          width: 8px;
          height: 12px;
          opacity: 0;
          z-index: 1001;
          animation: fall 3s linear forwards;
        }
        .shimmer {
          background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
          background-size: 200% 100%;
          animation: loadingShimmer 1.5s infinite;
        }
        @keyframes loadingShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* Confetti blast container */}
      {showConfetti && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1005 }}>
          {confettiArray.map((_, idx) => {
            const left = Math.random() * 100;
            const delay = Math.random() * 2.5;
            const duration = 2.5 + Math.random() * 1.5;
            const colors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            return (
              <div
                key={idx}
                className="confetti-particle"
                style={{
                  left: `${left}%`,
                  backgroundColor: randomColor,
                  animationDelay: `${delay}s`,
                  animationDuration: `${duration}s`
                }}
              />
            );
          })}
        </div>
      )}

      <div style={sheetStyle}>
        {/* Step Indicator Header (Hide in step 4) */}
        {step < 4 && (
          <div style={progressHeader}>
            <div style={{ display: 'flex', flex: 1, marginRight: '16px' }}>
              <div style={stepDot(step >= 1)} />
              <div style={stepDot(step >= 2)} />
              <div style={stepDot(step >= 3)} />
            </div>
            <button
              onClick={handleClose}
              style={{ border: 'none', background: 'none', fontSize: '20px', fontWeight: 'bold', color: '#64748b', cursor: 'pointer' }}
            >
              &times;
            </button>
          </div>
        )}

        {/* STEP 1: PHOTO UPLOAD */}
        {step === 1 && (
          <div>
            <h2 style={titleStyle}>Upload Civic Hazard</h2>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>
              Select a photo of the pothole, water leak, or waste heap to let Gemini AI analyze it.
            </p>

            {error && (
              <div style={{ backgroundColor: '#fef2f2', color: '#b91c1c', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', fontWeight: '600' }}>
                {error}
              </div>
            )}

            <div style={previewBoxStyle}>
              <div style={{ textAlign: 'center', color: '#64748b' }}>
                <span style={{ fontSize: '40px', display: 'block', marginBottom: '8px' }}>📸</span>
                <span style={{ fontSize: '14px', fontWeight: '700' }}>Take photo or pick from gallery</span>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>Supports PNG, JPG, WebP</p>
              </div>
              <input type="file" accept="image/*" onChange={handleImageChange} style={fileInputStyle} />
            </div>

            <span style={labelStyle}>Or select a demonstration preset:</span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <button onClick={() => handleLoadMockImage('pothole')} style={{ padding: '8px 12px', borderRadius: '10px', border: '1.5px solid #e2e8f0', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: '#f8fafc' }}>
                🕳️ Pothole
              </button>
              <button onClick={() => handleLoadMockImage('water_leak')} style={{ padding: '8px 12px', borderRadius: '10px', border: '1.5px solid #e2e8f0', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: '#f8fafc' }}>
                💧 Leak
              </button>
              <button onClick={() => handleLoadMockImage('broken_light')} style={{ padding: '8px 12px', borderRadius: '10px', border: '1.5px solid #e2e8f0', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: '#f8fafc' }}>
                💡 Light
              </button>
              <button onClick={() => handleLoadMockImage('waste')} style={{ padding: '8px 12px', borderRadius: '10px', border: '1.5px solid #e2e8f0', cursor: 'pointer', fontSize: '13px', fontWeight: '700', backgroundColor: '#f8fafc' }}>
                🗑️ Waste
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: AI REVIEW SCREEN */}
        {step === 2 && (
          <div>
            <h2 style={titleStyle}>Verify AI Analysis</h2>
            
            {analyzing ? (
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                {/* Shimmer box */}
                <div className="shimmer" style={{ width: '100%', height: '140px', borderRadius: '16px', marginBottom: '16px' }} />
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#16a34a', display: 'block' }}>
                  🤖 Analysing photo with Gemini Vision...
                </span>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>Extracting category, severity and details</p>
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                  <img src={imagePreview} alt="Target" style={{ width: '80px', height: '80px', borderRadius: '10px', objectFit: 'cover' }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: '800' }}>GEMINI VISION MATCHED</div>
                    <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#0f172a', textTransform: 'capitalize' }}>
                      {category.replace('_', ' ')} Detected
                    </div>
                  </div>
                </div>

                {/* Category Chips */}
                <span style={labelStyle}>Category</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      style={chipStyle(category === cat, '#16a34a')}
                    >
                      {categoryEmojis[cat]} {cat.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                {/* Severity Segmented Control */}
                <span style={labelStyle}>Severity Level</span>
                <div style={segmentedControl}>
                  {severities.map((sev) => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => setSeverity(sev)}
                      style={segmentBtn(severity === sev)}
                    >
                      {sev}
                    </button>
                  ))}
                </div>

                {/* Description Input */}
                <span style={labelStyle}>Description / Hazard Summary</span>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="One-line description..."
                  style={textInputStyle}
                />

                <button onClick={() => setStep(3)} style={buttonStyle(false)}>
                  Confirm & Set Location &rarr;
                </button>
                <button onClick={() => setStep(1)} style={buttonStyle(false, 'secondary')}>
                  Retake Photo
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: LOCATION SETTING */}
        {step === 3 && (
          <div>
            <h2 style={titleStyle}>Set Hazard Location</h2>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#64748b' }}>
              Provide the location details where this hazard is located.
            </p>

            {error && (
              <div style={{ backgroundColor: '#fef2f2', color: '#b91c1c', padding: '12px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', fontWeight: '600' }}>
                {error}
              </div>
            )}

            {/* Location Mode Toggle */}
            <div style={segmentedControl}>
              <button type="button" onClick={() => setLocationMode('gps')} style={segmentBtn(locationMode === 'gps')}>
                📡 Auto GPS
              </button>
              <button type="button" onClick={() => setLocationMode('map')} style={segmentBtn(locationMode === 'map')}>
                🗺️ Drop Pin
              </button>
              <button type="button" onClick={() => setLocationMode('address')} style={segmentBtn(locationMode === 'address')}>
                🔍 Type Area
              </button>
            </div>

            {locationMode === 'gps' && (
              <div style={{ textAlign: 'center', padding: '16px 0', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #cbd5e1', marginBottom: '20px' }}>
                <span style={{ fontSize: '28px', display: 'block', marginBottom: '6px' }}>📡</span>
                <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{locating ? 'GPS Locating...' : addressString}</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                  {latitude.toFixed(5)}, {longitude.toFixed(5)}
                </div>
                <button type="button" onClick={handleGPSSetup} style={{ border: 'none', background: 'none', color: '#16a34a', fontWeight: 'bold', fontSize: '13px', marginTop: '10px', cursor: 'pointer' }}>
                  Refresh GPS
                </button>
              </div>
            )}

            {locationMode === 'map' && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ height: '140px', width: '100%', borderRadius: '12px', overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '8px' }}>
                  <MapContainer center={[latitude, longitude]} zoom={14} zoomControl={false} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <MapClickPicker setLatitude={setLatitude} setLongitude={setLongitude} setAddressString={setAddressString} />
                    <CircleMarker
                      center={[latitude, longitude]}
                      radius={12}
                      pathOptions={{
                        color: '#16a34a',
                        fillColor: '#16a34a',
                        fillOpacity: 0.85,
                        weight: 2
                      }}
                    />
                  </MapContainer>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                  Tap on the map above to move the hazard pin location.
                </div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', marginTop: '8px', color: '#0f172a' }}>
                  📍 {addressString}
                </div>
              </div>
            )}

            {locationMode === 'address' && (
              <div>
                <form onSubmit={handleAddressSearch} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <input
                    type="text"
                    placeholder="Enter area name (e.g. Adyar, Chennai)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ ...textInputStyle, marginBottom: 0 }}
                  />
                  <button type="submit" style={{ ...buttonStyle(false), marginTop: 0, width: '80px', padding: '10px' }}>
                    Find
                  </button>
                </form>
                {locating && <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 'bold', marginBottom: '10px' }}>Searching...</div>}
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#0f172a', marginBottom: '20px' }}>
                  📍 {addressString} <span style={{ fontSize: '11px', color: '#64748b' }}>({latitude.toFixed(4)}, {longitude.toFixed(4)})</span>
                </div>
              </div>
            )}

            <button onClick={handleSubmitReport} disabled={submitting || locating} style={buttonStyle(submitting || locating)}>
              {submitting ? 'Filing Issue...' : 'Submit Report'}
            </button>
            <button onClick={() => setStep(2)} style={buttonStyle(false, 'secondary')}>
              &larr; Back
            </button>
          </div>
        )}

        {/* STEP 4: SUCCESS CARD */}
        {step === 4 && successData && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <span style={{ fontSize: '48px', display: 'block', marginBottom: '8px' }}>🎉</span>
            
            {/* XP Award Animation */}
            <span style={{
              display: 'inline-block',
              backgroundColor: '#dcfce7',
              color: '#16a34a',
              fontWeight: '800',
              fontSize: '18px',
              padding: '8px 20px',
              borderRadius: '24px',
              marginBottom: '16px',
              boxShadow: '0 4px 10px rgba(22, 163, 74, 0.2)',
              animation: 'bounce 1s infinite'
            }}>
              +10 XP File Reward!
            </span>

            <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
              Issue #{successData.id} Filed!
            </h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#64748b' }}>
              Thank you! The community has been notified.
            </p>

            <div style={{
              backgroundColor: '#f8fafc',
              padding: '16px',
              borderRadius: '16px',
              textAlign: 'left',
              border: '1px solid #cbd5e1',
              marginBottom: '24px'
            }}>
              <div style={{ fontSize: '14px', color: '#0f172a', marginBottom: '8px' }}>
                <strong>AI Detail:</strong> {successData.ai_summary || successData.description}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#e2e8f0', color: '#475569' }}>
                  {categoryEmojis[successData.category] || '⚠️'} {successData.category}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                  Severity Level {successData.severity}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#dbeafe', color: '#1e40af' }}>
                  📍 {successData.ward}
                </span>
              </div>
            </div>

            <button onClick={handleClose} style={buttonStyle(false)}>
              Done & View on Map
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReportForm;
