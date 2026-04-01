import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
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

// Pedestrians
export const getRecentPedestrians = () => api.get('/pedestrians/recent').then(res => res.data);
export const registerPedestrian = (data) => api.post('/pedestrians/entry', data).then(res => res.data);

// Vehicles
export const getRecentVehicles = () => api.get('/vehicles/recent').then(res => res.data);
export const registerVehicle = (data) => api.post('/vehicles/entry', data).then(res => res.data);

// Incidents
export const getRecentIncidents = () => api.get('/incidents/recent').then(res => res.data);
export const reportIncident = (data) => api.post('/incidents/report', data).then(res => res.data);

// OB Entries
export const getRecentOBEntries = () => api.get('/obentries/recent').then(res => res.data);
export const createOBEntry = (data) => api.post('/obentries/create', data).then(res => res.data);

export default api;

export const saveIncident = (data) => api.post('/incidents/report', data).then(res => res.data);
