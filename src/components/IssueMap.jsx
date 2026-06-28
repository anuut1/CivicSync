import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents, useMap, Marker, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useStore } from '../utils/store';
import { getMapIssues } from '../api/client';
import TopBar from './TopBar';

// Custom Leaflet Cluster Icon Creator
const createClusterIcon = (count) => {
  return L.divIcon({
    html: `<div style="
      background-color: #16a34a;
      color: #ffffff;
      border: 3.5px solid #ffffff;
      border-radius: 50%;
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      box-shadow: 0 4px 15px rgba(22, 163, 74, 0.45);
    ">${count}</div>`,
    className: 'custom-cluster-icon',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
};

// Colors mapped by status (with fallback for critical severity)
const getMarkerColor = (issue) => {
  if (Number(issue.severity) === 4) return '#ef4444'; // Red for critical severity
  const status = issue.status?.toLowerCase();
  if (status === 'resolved') return '#22c55e'; // Green
  if (status === 'verified' || status === 'assigned') return '#2563eb'; // Blue
  return '#f97316'; // Orange for pending
};

// Distance-based clustering algorithm
const clusterIssues = (issuesList, zoomLevel) => {
  if (zoomLevel >= 14) {
    return issuesList.map(issue => ({ type: 'issue', data: issue }));
  }

  // Grid-based clustering width
  const gridSize = 0.018 * Math.pow(2, 12 - zoomLevel);
  const clusters = [];
  const visited = new Set();

  for (let i = 0; i < issuesList.length; i++) {
    if (visited.has(issuesList[i].id)) continue;

    const baseIssue = issuesList[i];
    visited.add(baseIssue.id);

    const clusterMembers = [baseIssue];
    const baseLat = parseFloat(baseIssue.latitude);
    const baseLon = parseFloat(baseIssue.longitude);

    for (let j = i + 1; j < issuesList.length; j++) {
      if (visited.has(issuesList[j].id)) continue;

      const targetIssue = issuesList[j];
      const targetLat = parseFloat(targetIssue.latitude);
      const targetLon = parseFloat(targetIssue.longitude);

      const latDiff = Math.abs(baseLat - targetLat);
      const lonDiff = Math.abs(baseLon - targetLon);

      if (latDiff < gridSize && lonDiff < gridSize) {
        clusterMembers.push(targetIssue);
        visited.add(targetIssue.id);
      }
    }

    if (clusterMembers.length > 1) {
      const avgLat = clusterMembers.reduce((sum, item) => sum + parseFloat(item.latitude), 0) / clusterMembers.length;
      const avgLon = clusterMembers.reduce((sum, item) => sum + parseFloat(item.longitude), 0) / clusterMembers.length;
      clusters.push({
        type: 'cluster',
        id: `cluster-${baseIssue.id}`,
        latitude: avgLat,
        longitude: avgLon,
        count: clusterMembers.length,
        issues: clusterMembers
      });
    } else {
      clusters.push({ type: 'issue', data: baseIssue });
    }
  }
  return clusters;
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

const getWardDensityColor = (wardName, issuesList) => {
  const activeCount = issuesList.filter(i => i.ward === wardName && i.status !== 'resolved').length;
  if (activeCount === 0) return '#22c55e'; // Green - stable
  if (activeCount <= 2) return '#f59e0b'; // Amber - warning
  return '#ef4444'; // Red - critical density
};

// Sub-component to sync map view with selected issue
function MapRecenter() {
  const map = useMap();
  const selectedIssue = useStore((state) => state.selectedIssue);

  useEffect(() => {
    if (selectedIssue) {
      const lat = parseFloat(selectedIssue.latitude);
      const lon = parseFloat(selectedIssue.longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        map.setView([lat, lon], 16);
      }
    }
  }, [selectedIssue, map]);

  return null;
}

// Sub-component to broadcast map center and zoom level changes
function MapEventsAndSearch({ setZoom }) {
  const { setIssues, setMapCenter, selectedStatuses } = useStore();
  const map = useMap();

  const fetchIssues = async (mapInstance) => {
    if (!mapInstance) return;
    try {
      const bounds = mapInstance.getBounds();
      const query = {
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lon: bounds.getWest(),
        max_lon: bounds.getEast(),
        include_resolved: selectedStatuses.includes('resolved')
      };
      const response = await getMapIssues(query);
      setIssues(response.data);
    } catch (err) {
      console.error('Error querying issues for map bounds:', err);
    }
  };

  const mapEvents = useMapEvents({
    moveend: () => {
      fetchIssues(mapEvents);
      const center = mapEvents.getCenter();
      setMapCenter([center.lat, center.lng]);
    },
    zoomend: () => {
      setZoom(mapEvents.getZoom());
    }
  });

  useEffect(() => {
    fetchIssues(map);
  }, [selectedStatuses, map]);

  return null;
}

// Sub-component to capture Leaflet Map instance
function MapController({ mapRef }) {
  const map = useMap();
  useEffect(() => {
    if (map && mapRef) {
      mapRef.current = map;
    }
  }, [map, mapRef]);
  return null;
}

function MapCenterUpdater() {
  const map = useMap();
  const mapCenter = useStore((state) => state.mapCenter);

  useEffect(() => {
    if (mapCenter) {
      const center = map.getCenter();
      if (Math.abs(center.lat - mapCenter[0]) > 0.0001 || Math.abs(center.lng - mapCenter[1]) > 0.0001) {
        map.flyTo(mapCenter, 15, { duration: 1.5 });
      }
    }
  }, [mapCenter, map]);

  return null;
}

// Cluster Markers & Circle Markers Renderer
function ClusterMarkers({ clusters, selectIssue }) {
  const map = useMap();

  return clusters.map((cluster) => {
    if (cluster.type === 'cluster') {
      return (
        <Marker
          key={cluster.id}
          position={[cluster.latitude, cluster.longitude]}
          icon={createClusterIcon(cluster.count)}
          eventHandlers={{
            click: () => {
              map.setView([cluster.latitude, cluster.longitude], Math.min(map.getZoom() + 3, 16));
            }
          }}
        />
      );
    } else {
      const issue = cluster.data;
      const lat = parseFloat(issue.latitude);
      const lon = parseFloat(issue.longitude);
      if (isNaN(lat) || isNaN(lon)) return null;

      const isUrgent = issue.status !== 'resolved' && (Date.now() - new Date(issue.created_at).getTime()) > 7 * 24 * 60 * 60 * 1000;
      return (
        <CircleMarker
          key={issue.id}
          center={[lat, lon]}
          radius={(Number(issue.severity) * 3) + 7}
          pathOptions={{
            color: getMarkerColor(issue),
            fillColor: getMarkerColor(issue),
            fillOpacity: 0.6,
            weight: 2,
            className: isUrgent ? 'pulsing-marker marker-bounce-animation' : 'marker-bounce-animation'
          }}
          eventHandlers={{
            click: () => {
              selectIssue(issue);
            },
          }}
        />
      );
    }
  });
}

function IssueMap() {
  const { 
    issues, 
    selectIssue, 
    selectedCategories, 
    selectedStatuses,
    mapMode,
    sortBy,
    mapCenter,
    setToast 
  } = useStore();
  const [zoom, setZoom] = useState(13);
  const mapRef = useRef(null);

  const containerStyle = {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 0,
  };

  const getSeverityRank = (issue) => {
    const sev = issue.severity?.toString().toLowerCase();
    if (sev === 'critical' || sev === '4') return 4;
    if (sev === 'high' || sev === '3') return 3;
    if (sev === 'medium' || sev === 'moderate' || sev === '2') return 2;
    return 1;
  };

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c; // km
  };

  const searchAddress = async (query, coords = null) => {
    if (coords) {
      if (mapRef.current) {
        mapRef.current.flyTo(coords, 15, {
          animate: true,
          duration: 1.2
        });
      }
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=in&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      if (data.length > 0) {
        const { lat, lon } = data[0];
        if (mapRef.current) {
          mapRef.current.flyTo([parseFloat(lat), parseFloat(lon)], 15, {
            animate: true,
            duration: 1.2
          });
        }
      } else {
        setToast({
          message: 'Try being more specific — e.g. "Anna Nagar Chennai"',
          type: 'warning'
        });
      }
    } catch (err) {
      console.error("Geocoding search failed:", err);
      setToast({
        message: 'Search failed. Please try again.',
        type: 'error'
      });
    }
  };

  const handleGPS = () => {
    if (!mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        mapRef.current.flyTo([lat, lon], 15, {
          animate: true,
          duration: 1.2
        });
      },
      (err) => {
        console.warn("GPS lookup failed:", err);
        setToast({
          message: 'Could not access your device location. Please search for an area instead.',
          type: 'warning'
        });
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  // Client-side filtering based on categories & status
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

  // Client-side sorting
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    if (sortBy === 'recent') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortBy === 'upvoted') {
      return (b.vote_count || 0) - (a.vote_count || 0);
    }
    if (sortBy === 'severity') {
      return getSeverityRank(b) - getSeverityRank(a);
    }
    if (sortBy === 'nearest') {
      const distA = getDistance(parseFloat(a.latitude), parseFloat(a.longitude), mapCenter[0], mapCenter[1]);
      const distB = getDistance(parseFloat(b.latitude), parseFloat(b.longitude), mapCenter[0], mapCenter[1]);
      return distA - distB;
    }
    return 0;
  });

  // Group issues into clusters or individual markers based on mapMode
  const clusters = mapMode === 'markers'
    ? sortedIssues.map(issue => ({ type: 'issue', data: issue }))
    : clusterIssues(sortedIssues, zoom);

  return (
    <div style={containerStyle}>
      <TopBar onSearch={searchAddress} onGPS={handleGPS} />

      <MapContainer
        center={[13.0827, 80.2707]}
        zoom={12}
        zoomControl={false}
        ref={mapRef}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapEventsAndSearch setZoom={setZoom} />
        <MapController mapRef={mapRef} />
        <MapRecenter />
        <MapCenterUpdater />

        {/* Draw Ward Polygons Heat Overlays */}
        {mapMode === 'heatmap' && Object.entries(getDynamicWardPolygons(issues)).map(([wardName, data]) => {
          const densityColor = getWardDensityColor(wardName, issues);
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
            />
          );
        })}

        <ClusterMarkers clusters={clusters} selectIssue={selectIssue} />
      </MapContainer>
    </div>
  );
}

export default IssueMap;
