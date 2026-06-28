import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : 'https://civicsync-db1v.onrender.com');

const api = axios.create({ baseURL: API_URL });

// attach JWT from localStorage on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('civisync_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const reportIssue = (formData) => 
  api.post('/issues/report', formData, { 
    headers: { 'Content-Type': 'multipart/form-data' } 
  });

export const analyzeIssue = (formData) =>
  api.post('/issues/analyze', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

export const getIssueById = (id) =>
  api.get(`/issues/${id}`);

export const getAdminMetrics = () =>
  api.get('/admin/metrics');

export const getMapIssues = (bounds) => 
  api.get('/issues/map', { params: bounds });

export const voteIssue = (id) => 
  api.post(`/issues/${id}/vote`);

export const getActiveAlerts = () => 
  api.get('/alerts/active');

export const runPredictions = () => 
  api.post('/alerts/run-predictions');

export const getLeaderboard = () => 
  api.get('/alerts/leaderboard');

export const sendChatMessage = (message) =>
  api.post('/chat', { message });

export const getChatIntent = (message) =>
  api.post('/chat/intent', { message });

export const getUserLeaderboard = () =>
  api.get('/users/leaderboard');

export const compilePredictions = () =>
  api.post('/admin/compile-predictions');

export default api;
