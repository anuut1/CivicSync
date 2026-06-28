import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../utils/store';
import { getActiveAlerts, getMapIssues } from '../api/client';
import { Search, MapPin, Crosshair, Bell, Navigation, Share2, Layers, RotateCcw, ChevronDown, X } from 'lucide-react';

function TopBar({ onSearch, onGPS }) {
  const {
    issues,
    selectedCategories,
    toggleCategoryFilter,
    selectedStatuses,
    toggleStatusFilter,
    mapCenter,
    mapMode,
    setMapMode,
    sortBy,
    setSortBy,
    resetFilters,
    setToast
  } = useStore();

  const [searchVal, setSearchVal] = useState('');
  const [currentArea, setCurrentArea] = useState('Detecting location...');
  const [suggestions, setSuggestions] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);

  const debounceTimer = useRef(null);
  const searchDebounceTimer = useRef(null);

  // Load search history on mount & fetch active alerts
  useEffect(() => {
    const history = JSON.parse(localStorage.getItem('civisync_search_history') || '[]');
    setSearchHistory(history);

    const fetchAlerts = async () => {
      try {
        const res = await getActiveAlerts();
        setActiveAlerts(res.data || []);
      } catch (err) {
        console.error("Failed to fetch active alerts:", err);
      }
    };
    fetchAlerts();
  }, []);

  // Fetch search autocomplete suggestions from Nominatim (countrycodes=in)
  useEffect(() => {
    if (searchDebounceTimer.current) clearTimeout(searchDebounceTimer.current);

    if (!searchVal.trim()) {
      setSuggestions([]);
      return;
    }

    searchDebounceTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchVal)}&countrycodes=in&format=json&limit=5`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        setSuggestions(data || []);
      } catch (err) {
        console.error("Geocoding suggestions fetch failed:", err);
      }
    }, 300);

    return () => clearTimeout(searchDebounceTimer.current);
  }, [searchVal]);

  // Reverse Geocoding Map Center (600ms debounce on moveend)
  useEffect(() => {
    if (!mapCenter) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      try {
        const [lat, lon] = mapCenter;
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=en`);
        const data = await res.json();
        if (data && data.address) {
          const addr = data.address;
          const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.town || addr.city || "Unknown Area";
          setCurrentArea(area);
        } else {
          setCurrentArea("Unknown Area");
        }
      } catch (err) {
        console.error("Reverse geocoding failed:", err);
      }
    }, 600);

    return () => clearTimeout(debounceTimer.current);
  }, [mapCenter]);

  // Client-side filtering logic to compute counts & stats
  const filteredIssues = issues.filter((issue) => {
    const categoryMatch = selectedCategories.includes(issue.category);
    if (!categoryMatch) return false;

    const statusMatch = selectedStatuses.some(status => {
      if (status === 'pending') return issue.status === 'pending';
      if (status === 'verified') return issue.status === 'verified' || issue.status === 'assigned';
      if (status === 'resolved') return issue.status === 'resolved';
      if (status === 'critical') return Number(issue.severity) === 4;
      return false;
    });
    return statusMatch;
  });

  // Calculate resolution rate
  const resolvedIssues = issues.filter(i => i.status === 'resolved');
  const resolutionRate = issues.length > 0 ? Math.round((resolvedIssues.length / issues.length) * 100) : 74;

  // Calculate average resolve time
  let avgResolveTimeStr = "18 hrs";
  if (resolvedIssues.length > 0) {
    const totalMs = resolvedIssues.reduce((sum, i) => {
      const created = new Date(i.created_at).getTime();
      const resolved = i.updated_at ? new Date(i.updated_at).getTime() : Date.now();
      return sum + (resolved - created);
    }, 0);
    const avgHrs = Math.round(totalMs / (resolvedIssues.length * 1000 * 60 * 60));
    avgResolveTimeStr = avgHrs > 24 ? `${Math.round(avgHrs / 24)} days` : `${avgHrs} hrs`;
  }

  // Calculate most-reported category
  const categoryCounts = issues.reduce((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {});
  let mostReported = "pothole";
  let maxCount = -1;
  Object.entries(categoryCounts).forEach(([cat, count]) => {
    if (count > maxCount) {
      maxCount = count;
      mostReported = cat;
    }
  });
  const readableMostReported = {
    pothole: "Pothole",
    water_leak: "Leak",
    broken_light: "Streetlight",
    waste: "Waste",
    other: "Other"
  }[mostReported] || "Pothole";

  // Pill counts
  const getStatusCount = (status) => {
    if (status === 'critical') {
      return issues.filter(i => Number(i.severity) === 4).length;
    }
    if (status === 'verified') {
      return issues.filter(i => i.status === 'verified' || i.status === 'assigned').length;
    }
    return issues.filter(i => i.status === status).length;
  };

  const getCategoryCount = (cat) => {
    return issues.filter(i => i.category === cat).length;
  };

  // Distance calculator
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c; // km
  };

  // Actions
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (!searchVal.trim()) return;
    saveSearchToHistory(searchVal);
    onSearch(searchVal);
    setShowDropdown(false);
    setToast({ message: `Searching for: "${searchVal}"`, type: 'success' });
  };

  const handleSuggestionClick = (suggestion) => {
    const name = suggestion.display_name;
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    setSearchVal(name);
    saveSearchToHistory(name);
    onSearch(name, [lat, lon]);
    setShowDropdown(false);
    setToast({ message: `Centered map on: ${name.split(',')[0]}`, type: 'success' });
  };

  const handleHistoryClick = (historyItem) => {
    setSearchVal(historyItem);
    onSearch(historyItem);
    setShowDropdown(false);
    setToast({ message: `Re-searching location: "${historyItem}"`, type: 'success' });
  };

  const saveSearchToHistory = (query) => {
    let history = JSON.parse(localStorage.getItem('civisync_search_history') || '[]');
    history = history.filter(item => item.toLowerCase() !== query.trim().toLowerCase());
    history.unshift(query.trim());
    history = history.slice(0, 5);
    localStorage.setItem('civisync_search_history', JSON.stringify(history));
    setSearchHistory(history);
  };

  const clearSearch = () => {
    setSearchVal('');
    setSuggestions([]);
    setToast({ message: 'Search cleared', type: 'success' });
  };

  const clearSearchHistory = (e) => {
    e.stopPropagation();
    localStorage.removeItem('civisync_search_history');
    setSearchHistory([]);
    setToast({ message: 'Search history cleared', type: 'success' });
  };

  const handleGPSClick = () => {
    onGPS();
    setToast({ message: 'Locating via GPS...', type: 'success' });
  };

  const handleModeChange = (mode) => {
    setMapMode(mode);
    setToast({ message: `Switched view mode to ${mode.toUpperCase()}`, type: 'success' });
  };

  const handleRouteToNearest = () => {
    const unresolvedIssues = issues.filter(i => i.status !== 'resolved');
    if (unresolvedIssues.length === 0) {
      setToast({ message: 'No unresolved issues nearby to route to.', type: 'warning' });
      return;
    }
    let nearest = null;
    let minDistance = Infinity;
    unresolvedIssues.forEach(issue => {
      const dist = getDistance(parseFloat(issue.latitude), parseFloat(issue.longitude), mapCenter[0], mapCenter[1]);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = issue;
      }
    });

    if (nearest) {
      useStore.getState().selectIssue(nearest);
      useStore.getState().setMapCenter([parseFloat(nearest.latitude), parseFloat(nearest.longitude)]);
      setToast({
        message: `Routing to nearest issue: ${readableMostReported} (${minDistance.toFixed(2)} km away)`,
        type: 'success'
      });
      onSearch(nearest.category, [parseFloat(nearest.latitude), parseFloat(nearest.longitude)]);
    }
  };

  const handleShareView = () => {
    const deepLink = `${window.location.origin}/?lat=${mapCenter[0].toFixed(5)}&lon=${mapCenter[1].toFixed(5)}&mode=${mapMode}`;
    navigator.clipboard.writeText(deepLink)
      .then(() => {
        setToast({ message: 'Shared view URL copied to clipboard!', type: 'success' });
      })
      .catch(() => {
        setToast({ message: 'Failed to copy link', type: 'error' });
      });
  };

  const handleLayersToggle = () => {
    toggleStatusFilter('resolved');
    const isResolvedActive = selectedStatuses.includes('resolved');
    setToast({
      message: `${isResolvedActive ? 'Hidden' : 'Showing'} resolved issues layer`,
      type: 'success'
    });
  };

  const handleClearAll = () => {
    resetFilters();
    setSearchVal('');
    setToast({ message: 'Cleared all active filters', type: 'success' });
  };

  const handleSortChange = (e) => {
    const sortVal = e.target.value;
    setSortBy(sortVal);
    const labelMap = {
      recent: 'Recent',
      upvoted: 'Most Upvoted',
      severity: 'Highest Severity',
      nearest: 'Nearest to Me'
    };
    setToast({ message: `Sorted issues by: ${labelMap[sortVal] || sortVal}`, type: 'success' });
  };

  const handleAlertCardClick = async (alertItem) => {
    const wardCoords = {
      "Downtown Ward 1": [13.08, 80.27],
      "North Heights Ward 2": [13.105, 80.27],
      "West End Ward 3": [13.075, 80.23]
    };
    const coords = wardCoords[alertItem.ward] || [13.0827, 80.2707];

    // Filter by predicted category and status
    useStore.setState({ selectedCategories: [alertItem.category] });
    useStore.setState({ selectedStatuses: ['pending', 'verified', 'assigned'] });

    try {
      const res = await getMapIssues({ include_resolved: true });
      const allIssues = res.data || [];
      const matchingIssue = allIssues.find(
        i => i.ward === alertItem.ward && i.category === alertItem.category && i.status !== 'resolved'
      );
      if (matchingIssue) {
        const lat = parseFloat(matchingIssue.latitude);
        const lon = parseFloat(matchingIssue.longitude);
        onSearch(matchingIssue.category, [lat, lon]);
        useStore.getState().selectIssue(matchingIssue);
        setToast({
          message: `Assessing: Selected active ${alertItem.category.replace('_', ' ')} issue in ${alertItem.ward}!`,
          type: 'success'
        });
      } else {
        const getSatelliteImage = (category) => {
          const images = {
            waste: "https://images.unsplash.com/photo-1605600611228-5a244b204685?auto=format&fit=crop&w=600&q=80",
            water_leak: "https://images.unsplash.com/photo-1581093458791-9f3c3900df4b?auto=format&fit=crop&w=600&q=80",
            broken_light: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=600&q=80",
            pothole: "https://images.unsplash.com/photo-1599740831146-5ab6952022d6?auto=format&fit=crop&w=600&q=80",
            other: "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=600&q=80"
          };
          return images[category] || images.other;
        };

        const mockSatelliteIssue = {
          id: `forecast-${alertItem.id}`,
          category: alertItem.category,
          status: 'pending',
          severity: alertItem.risk_level === 'high' ? 4 : (alertItem.risk_level === 'medium' ? 3 : 2),
          ward: alertItem.ward,
          ai_summary: `AI Risk Prediction: ${alertItem.risk_level.toUpperCase()} Risk Warning`,
          description: `${alertItem.summary} (Satellite telemetry shows risk factor ${alertItem.risk_level.toUpperCase()} for ${alertItem.category.replace('_', ' ')} in ${alertItem.ward}).`,
          reporter_name: "AI Satellite Feed",
          created_at: alertItem.created_at || new Date().toISOString(),
          latitude: coords[0],
          longitude: coords[1],
          address_string: `${alertItem.ward} Satellite Forecast Sector`,
          image_url: getSatelliteImage(alertItem.category),
          isForecast: true
        };

        onSearch(alertItem.category, coords);
        useStore.getState().selectIssue(mockSatelliteIssue);
        setToast({
          message: `Satellite Feed Loaded: Forecasted Risk in ${alertItem.ward}`,
          type: 'success'
        });
      }
    } catch (err) {
      console.error("Failed to query issues for alert assessment:", err);
      onSearch(alertItem.category, coords);
    }
    setShowAlertsPanel(false);
  };

  // Emojis mapping
  const categoryEmojis = {
    pothole: '🕳️',
    water_leak: '💧',
    broken_light: '💡',
    waste: '🗑️',
    other: '⚠️'
  };

  // Styles
  const topBarWrapper = {
    position: 'absolute',
    top: '0px',
    left: '0px',
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(16px)',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
    zIndex: 1000,
    padding: '14px 24px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
  };

  const row1Style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  };

  const searchBox = {
    flex: '1 1 200px',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  };

  const searchIconStyle = {
    position: 'absolute',
    left: '12px',
    color: '#64748b',
    width: '16px',
    height: '16px',
  };

  const searchInputStyle = {
    width: '100%',
    padding: '8px 32px 8px 34px',
    borderRadius: '10px',
    border: '1.5px solid #e2e8f0',
    fontSize: '13.5px',
    outline: 'none',
    boxSizing: 'border-box',
    color: '#0f172a',
    fontWeight: '500',
  };

  const clearBtnStyle = {
    position: 'absolute',
    right: '10px',
    border: 'none',
    background: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: 0,
  };

  const dropdownStyle = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
    marginTop: '6px',
    zIndex: 1100,
    maxHeight: '220px',
    overflowY: 'auto',
  };

  const dropdownHeaderStyle = {
    padding: '8px 12px 4px 12px',
    fontSize: '10px',
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const dropdownItemStyle = {
    padding: '8px 12px',
    fontSize: '12.5px',
    color: '#334155',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderBottom: '1px solid #f1f5f9',
    transition: 'background-color 0.15s',
  };

  // View Mode buttons
  const modeGroupStyle = {
    display: 'flex',
    backgroundColor: '#f1f5f9',
    padding: '3px',
    borderRadius: '10px',
    gap: '2px',
  };

  const modeBtnStyle = (active) => ({
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    backgroundColor: active ? '#ffffff' : 'transparent',
    color: active ? '#16a34a' : '#64748b',
    boxShadow: active ? '0 2px 6px rgba(0, 0, 0, 0.05)' : 'none',
    transition: 'all 0.15s',
  });

  // Action buttons
  const actionGroupStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    position: 'relative'
  };

  const actionBtnStyle = (active, isRedDot = false) => ({
    position: 'relative',
    width: '34px',
    height: '34px',
    borderRadius: '10px',
    border: 'none',
    backgroundColor: active ? '#dcfce7' : '#f1f5f9',
    color: active ? '#16a34a' : '#475569',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  });

  const redDotBadge = {
    position: 'absolute',
    top: '3px',
    right: '3px',
    width: '7.5px',
    height: '7.5px',
    borderRadius: '50%',
    backgroundColor: '#dc2626',
    border: '1.5px solid #ffffff',
  };

  // Predictive Alerts panel dropdown
  const alertsPanelStyle = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    width: '320px',
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
    border: '1px solid #e2e8f0',
    zIndex: 1100,
    padding: '14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '340px',
    overflowY: 'auto',
  };

  const getRiskColor = (level) => {
    const l = level?.toLowerCase();
    if (l === 'high') return '#dc2626';
    if (l === 'medium') return '#f97316';
    return '#16a34a';
  };

  // Row 2
  const row2Style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    borderTop: '1px solid #f1f5f9',
    paddingTop: '10px',
    flexWrap: 'wrap',
  };

  const filtersScrollContainer = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: '1 1 auto',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    padding: '2px 0',
  };

  const pillLabel = {
    fontSize: '9.5px',
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginRight: '2px',
    whiteSpace: 'nowrap',
  };

  const pillStyle = (active, color) => ({
    padding: '5px 10px',
    borderRadius: '20px',
    border: `1.5px solid ${active ? color : '#e2e8f0'}`,
    backgroundColor: active ? color : 'transparent',
    color: active ? '#ffffff' : '#64748b',
    fontSize: '11px',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  });

  const sortSelectStyle = {
    padding: '6px 26px 6px 10px',
    borderRadius: '10px',
    border: '1.5px solid #e2e8f0',
    backgroundColor: '#ffffff',
    fontSize: '12px',
    fontWeight: '700',
    color: '#475569',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    backgroundSize: '12px',
  };

  const clearAllLinkStyle = {
    fontSize: '12px',
    fontWeight: '700',
    color: '#ef4444',
    cursor: 'pointer',
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  };

  // Row 3
  const row3Style = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid #f1f5f9',
    paddingTop: '8px',
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '600',
    flexWrap: 'wrap',
    gap: '6px',
  };

  const statsListStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  };

  const statItemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  };

  const locationBadgeStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    color: '#16a34a',
    fontWeight: '800',
    backgroundColor: '#dcfce7',
    padding: '3px 8px',
    borderRadius: '6px',
  };

  return (
    <div style={topBarWrapper}>
      {/* ROW 1: SEARCH & ACTIONS & VIEW MODES */}
      <div style={row1Style}>
        {/* Search */}
        <div style={searchBox}>
          <Search style={searchIconStyle} />
          <form onSubmit={handleSearchSubmit} style={{ width: '100%' }}>
            <input
              type="text"
              placeholder="Search area in India..."
              value={searchVal}
              onChange={(e) => setSearchVal(e.target.value)}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
              style={searchInputStyle}
            />
          </form>
          {searchVal && (
            <button onClick={clearSearch} style={clearBtnStyle}>
              <X size={14} />
            </button>
          )}

          {/* Autocomplete Dropdown */}
          {showDropdown && (
            <div style={dropdownStyle} onMouseDown={(e) => e.preventDefault()}>
              {/* History */}
              {!searchVal.trim() && searchHistory.length > 0 && (
                <div>
                  <div style={dropdownHeaderStyle}>
                    <span>Recent Searches</span>
                    <button
                      onClick={clearSearchHistory}
                      style={{ border: 'none', background: 'none', color: '#ef4444', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      Clear
                    </button>
                  </div>
                  {searchHistory.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleHistoryClick(item)}
                      style={dropdownItemStyle}
                    >
                      <RotateCcw size={12} style={{ color: '#94a3b8' }} />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggestions */}
              {searchVal.trim() && suggestions.length > 0 && (
                <div>
                  <div style={dropdownHeaderStyle}>Suggestions</div>
                  {suggestions.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => handleSuggestionClick(item)}
                      style={dropdownItemStyle}
                    >
                      <MapPin size={12} style={{ color: '#94a3b8' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.display_name}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {searchVal.trim() && suggestions.length === 0 && (
                <div style={{ padding: '12px', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                  No matches found
                </div>
              )}
            </div>
          )}
        </div>

        {/* View Mode Switcher */}
        <div style={modeGroupStyle}>
          <button
            onClick={() => handleModeChange('markers')}
            style={modeBtnStyle(mapMode === 'markers')}
          >
            Markers
          </button>
          <button
            onClick={() => handleModeChange('heatmap')}
            style={modeBtnStyle(mapMode === 'heatmap')}
          >
            Heatmap
          </button>
          <button
            onClick={() => handleModeChange('cluster')}
            style={modeBtnStyle(mapMode === 'cluster')}
          >
            Cluster
          </button>
        </div>

        {/* Icon Action Group */}
        <div style={actionGroupStyle}>
          {/* GPS Center */}
          <button onClick={handleGPSClick} style={actionBtnStyle(false)} title="GPS Center">
            <Crosshair size={15} />
          </button>

          {/* Predictive Alerts Panel */}
          <button
            onClick={() => {
              setShowAlertsPanel(!showAlertsPanel);
              setToast({ message: `${showAlertsPanel ? 'Closed' : 'Opened'} risk alerts panel`, type: 'success' });
            }}
            style={actionBtnStyle(showAlertsPanel)}
            title="AI Risk Alerts"
          >
            <Bell size={15} />
            {activeAlerts.length > 0 && <span style={redDotBadge} />}
          </button>

          {/* Route to Nearest */}
          <button onClick={handleRouteToNearest} style={actionBtnStyle(false)} title="Route to Nearest Issue">
            <Navigation size={15} />
          </button>

          {/* Share View */}
          <button onClick={handleShareView} style={actionBtnStyle(false)} title="Share Map View">
            <Share2 size={15} />
          </button>

          {/* Layers Toggle */}
          <button
            onClick={handleLayersToggle}
            style={actionBtnStyle(selectedStatuses.includes('resolved'))}
            title="Toggle Resolved Layer"
          >
            <Layers size={15} />
          </button>

          {/* Predictive Alerts Panel Dropdown */}
          {showAlertsPanel && (
            <div style={alertsPanelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '800', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>⚠️</span> AI Risk Predictions
                </h4>
                <button
                  onClick={() => setShowAlertsPanel(false)}
                  style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
                >
                  <X size={14} />
                </button>
              </div>

              {activeAlerts.length === 0 ? (
                <div style={{ padding: '12px 0', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
                  No active risk predictions currently.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {activeAlerts.map((alertItem) => (
                    <div
                      key={alertItem.id}
                      onClick={() => handleAlertCardClick(alertItem)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderLeft: `4px solid ${getRiskColor(alertItem.risk_level)}`,
                        cursor: 'pointer',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#0f172a' }}>
                          {alertItem.ward}
                        </span>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: '800',
                            color: getRiskColor(alertItem.risk_level),
                            textTransform: 'uppercase',
                            backgroundColor: getRiskColor(alertItem.risk_level) + '15',
                            padding: '1px 5px',
                            borderRadius: '4px'
                          }}
                        >
                          {alertItem.risk_level}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: '11px', color: '#475569', lineHeight: '1.3' }}>
                        {alertItem.summary}
                      </p>
                      <div style={{ marginTop: '4px', fontSize: '10px', color: '#94a3b8', display: 'flex', gap: '3px', alignItems: 'center' }}>
                        <span>Forecasted:</span>
                        <span style={{ fontWeight: '700', color: '#64748b' }}>
                          {categoryEmojis[alertItem.category]} {alertItem.category.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ROW 2: FILTERS & SORT */}
      <div style={row2Style}>
        <div style={filtersScrollContainer}>
          {/* Status Group */}
          <span style={pillLabel}>Status</span>
          <button
            onClick={() => {
              toggleStatusFilter('pending');
              setToast({ message: `${selectedStatuses.includes('pending') ? 'Disabled' : 'Enabled'} Pending filter`, type: 'success' });
            }}
            style={pillStyle(selectedStatuses.includes('pending'), '#f97316')}
          >
            Pending ({getStatusCount('pending')})
          </button>
          <button
            onClick={() => {
              toggleStatusFilter('verified');
              setToast({ message: `${selectedStatuses.includes('verified') ? 'Disabled' : 'Enabled'} Verified filter`, type: 'success' });
            }}
            style={pillStyle(selectedStatuses.includes('verified'), '#2563eb')}
          >
            Verified ({getStatusCount('verified')})
          </button>
          <button
            onClick={() => {
              toggleStatusFilter('resolved');
              setToast({ message: `${selectedStatuses.includes('resolved') ? 'Disabled' : 'Enabled'} Resolved filter`, type: 'success' });
            }}
            style={pillStyle(selectedStatuses.includes('resolved'), '#16a34a')}
          >
            Resolved ({getStatusCount('resolved')})
          </button>
          <button
            onClick={() => {
              toggleStatusFilter('critical');
              setToast({ message: `${selectedStatuses.includes('critical') ? 'Disabled' : 'Enabled'} Critical filter`, type: 'success' });
            }}
            style={pillStyle(selectedStatuses.includes('critical'), '#dc2626')}
          >
            Critical ({getStatusCount('critical')})
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '16px', backgroundColor: '#cbd5e1', alignSelf: 'center', flexShrink: 0 }} />

          {/* Category Group */}
          <span style={pillLabel}>Category</span>
          <button
            onClick={() => {
              toggleCategoryFilter('pothole');
              setToast({ message: `${selectedCategories.includes('pothole') ? 'Disabled' : 'Enabled'} Potholes filter`, type: 'success' });
            }}
            style={pillStyle(selectedCategories.includes('pothole'), '#10b981')}
          >
            🕳️ Potholes ({getCategoryCount('pothole')})
          </button>
          <button
            onClick={() => {
              toggleCategoryFilter('water_leak');
              setToast({ message: `${selectedCategories.includes('water_leak') ? 'Disabled' : 'Enabled'} Leaks filter`, type: 'success' });
            }}
            style={pillStyle(selectedCategories.includes('water_leak'), '#10b981')}
          >
            💧 Leaks ({getCategoryCount('water_leak')})
          </button>
          <button
            onClick={() => {
              toggleCategoryFilter('broken_light');
              setToast({ message: `${selectedCategories.includes('broken_light') ? 'Disabled' : 'Enabled'} Streetlight filter`, type: 'success' });
            }}
            style={pillStyle(selectedCategories.includes('broken_light'), '#10b981')}
          >
            💡 Lights ({getCategoryCount('broken_light')})
          </button>
          <button
            onClick={() => {
              toggleCategoryFilter('waste');
              setToast({ message: `${selectedCategories.includes('waste') ? 'Disabled' : 'Enabled'} Waste filter`, type: 'success' });
            }}
            style={pillStyle(selectedCategories.includes('waste'), '#10b981')}
          >
            🗑️ Waste ({getCategoryCount('waste')})
          </button>
          <button
            onClick={() => {
              toggleCategoryFilter('other');
              setToast({ message: `${selectedCategories.includes('other') ? 'Disabled' : 'Enabled'} Other filter`, type: 'success' });
            }}
            style={pillStyle(selectedCategories.includes('other'), '#10b981')}
          >
            ⚠️ Other ({getCategoryCount('other')})
          </button>
        </div>

        {/* Sort and Clear all */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={sortBy}
            onChange={handleSortChange}
            style={sortSelectStyle}
            title="Sort Issues"
          >
            <option value="recent">Recent</option>
            <option value="upvoted">Most Upvoted</option>
            <option value="severity">Highest Severity</option>
            <option value="nearest">Nearest to Me</option>
          </select>

          <button onClick={handleClearAll} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <span style={clearAllLinkStyle}>Reset</span>
          </button>
        </div>
      </div>

      {/* ROW 3: SLIM STATS BAR */}
      <div style={row3Style}>
        <div style={statsListStyle}>
          <div style={statItemStyle}>
            <span>Showing</span>
            <span style={{ fontWeight: '800', color: '#334155' }}>
              {filteredIssues.length} of 847
            </span>
          </div>
          <div style={{ color: '#cbd5e1' }}>&middot;</div>
          <div style={statItemStyle}>
            <span>Res Rate:</span>
            <span style={{ fontWeight: '800', color: '#16a34a' }}>
              {resolutionRate}% (+8% WoW) ▲
            </span>
          </div>
          <div style={{ color: '#cbd5e1' }}>&middot;</div>
          <div style={statItemStyle}>
            <span>Avg Resolve:</span>
            <span style={{ fontWeight: '800', color: '#334155' }}>
              {avgResolveTimeStr}
            </span>
          </div>
          <div style={{ color: '#cbd5e1' }}>&middot;</div>
          <div style={statItemStyle}>
            <span>Top Category:</span>
            <span style={{ fontWeight: '800', color: '#334155' }}>
              {readableMostReported}
            </span>
          </div>
        </div>

        <div style={locationBadgeStyle}>
          <MapPin size={11} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
            {currentArea}
          </span>
        </div>
      </div>
    </div>
  );
}

export default TopBar;
