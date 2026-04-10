import axios from 'axios';
import { supabase } from '../lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem('refresh_token');

        // No refresh token available - logout
        if (!refreshToken) {
          localStorage.removeItem('token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
          return Promise.reject(error);
        }

        // Attempt to refresh session
        const { data } = await supabase.auth.refreshSession({
          refresh_token: refreshToken
        });

        if (data?.session) {
          // Save new tokens
          localStorage.setItem('token', data.session.access_token);
          localStorage.setItem('refresh_token', data.session.refresh_token);

          // Update the failed request with new token and retry
          originalRequest.headers.Authorization = `Bearer ${data.session.access_token}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);

        // Clear all auth data and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('cached_user');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
// Auth
export const login = (credentials) => api.post('/auth/login', credentials);
export const logout = () => api.post('/auth/logout');
export const getCurrentUser = () => api.get('/auth/me');

// Patrols
export const getPatrols = () => api.get('/patrols').then(res => res.data);
export const getPatrolById = (id) => api.get(`/patrols/${id}`).then(res => res.data);
// Guard Patrol Dashboard Data
export const getGuardPatrolData = () => api.get('/patrols/dashboard').then(res => res.data);

// Alternative: If you need to fetch patrols and points separately and combine
export const getGuardPatrolDataCombined = async () => {
  const [patrolsRes, pointsRes] = await Promise.all([
    api.get('/patrols'),
    api.get('/patrols/points')
  ]);
  return {
    patrols: patrolsRes.data,
    scanPoints: pointsRes.data
  };
};
// services/api.js
export const getGuardReport = () => api.get('/reports/guard-hourly');
// Pedestrians
export const getRecentPedestrians = () => api.get('/pedestrians/recent').then(res => res.data);
export const registerPedestrian = (data) => api.post('/pedestrians/entry', data).then(res => res.data);
export const getPedestrianReport = async () => {
  const res = await api.get('/pedestrians/report');
  return res.data;
};
// Vehicles
export const getRecentVehicles = () => api.get('/vehicles/recent').then(res => res.data);
export const registerVehicle = (data) => api.post('/vehicles/entry', data).then(res => res.data);
export const getVehicleReport = async () => {
  const res = await api.get('/vehicles/report');
  return res.data;
};

// Incidents
export const getRecentIncidents = () => api.get('/incidents/recent').then(res => res.data);
export const reportIncident = (data) => api.post('/incidents/report', data).then(res => res.data);

// OB Entries
export const getRecentOBEntries = () => api.get('/obentries/recent').then(res => res.data);
export const createOBEntry = (data) => api.post('/obentries/create', data).then(res => res.data);
export default api;

export const saveIncident = (data) => api.post('/incidents/report', data).then(res => res.data);

export const getActiveShift = () => api.get('/shifts/active').then(res => res.data);
export const getGuardsList = () => api.get('/shifts/guards').then(res => res.data);
export const startShift = (data) => api.post('/shifts/start', data).then(res => res.data);
export const endShift = (data) => api.post('/shifts/end', data).then(res => res.data);

export const addGuard = (data) => api.post('/shifts/guards/add', data).then(res => res.data);

export const getCompletedShifts = () => api.get('/shifts/completed').then(res => res.data);


// Get patrols for current guard (backend uses JWT to identify guard)
export const getGuardPatrols = () => api.get('/patrols/my-patrols').then(res => res.data);

// Get patrols by specific guard ID (for admin view)
export const getPatrolsByGuard = (guardId) => api.get(`/patrols/guard/${guardId}`).then(res => res.data);

// Get all patrol checkpoints for current guard
export const getGuardCheckpoints = () => api.get('/patrols/my-checkpoints').then(res => res.data);

// Get dashboard data specific to logged-in guard
export const getGuardDashboardData = () => api.get('/patrols/dashboard').then(res => res.data);

// Get pedestrian report for current guard
export const getMyPedestrianReport = () => api.get('/pedestrians/my-report').then(res => res.data);

// Get vehicle report for current guard  
export const getMyVehicleReport = () => api.get('/vehicles/my-report').then(res => res.data);

// Admin: Get all guards with their stats
export const getGuardsWithStats = () => api.get('/guards/stats').then(res => res.data);
export const markPedestrianExit = (id) => api.patch(`/pedestrians/${id}/exit`).then(res => res.data);
export const markVehicleExit = (id) => api.patch(`/vehicles/${id}/exit`).then(res => res.data);

// Get guards list for login screen (no auth needed)
export const getGuardsBySite = (siteId) => api.get(`/auth/guards/${siteId}`).then(res => res.data);
export const guardLogin = (data) => api.post('/auth/guard-login', data);
export const guardLogout = () => api.post('/auth/guard-logout');

export const getGuards = () => api.get('/users/guards').then(res => res.data);
export const addGuardUser = (data) => api.post('/users/guards', data).then(res => res.data);
export const updateGuardPin = (id, pin) => api.patch(`/users/guards/${id}/pin`, { pin }).then(res => res.data);
export const toggleGuardActive = (id, is_active) => api.patch(`/users/guards/${id}/toggle`, { is_active }).then(res => res.data);

export const getMySite = () => api.get('/sites/mine').then(res => res.data);
export const updateMySite = (data) => api.put('/sites/mine', data).then(res => res.data);

export const logNFCScan = (data) => api.post('/nfc/scan', data).then(res => res.data);
export const registerNFCTag = (data) => api.post('/nfc/register', data).then(res => res.data);
export const getNFCCheckpoints = () => api.get('/nfc/checkpoints').then(res => res.data);
export const getNFCScans = () => api.get('/nfc/scans').then(res => res.data);