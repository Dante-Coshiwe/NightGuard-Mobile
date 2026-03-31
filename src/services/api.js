import axios from 'axios';
import { supabase } from './supabase';

const USE_MOCK = true;
let api; // Declare at module level

// Mock data
const mockPatrols = [
  {
    id: 1,
    patrol_name: "Morning Perimeter",
    status: "in_progress",
    total_checkpoints: 5,
    checkpoints_completed: 2,
    patrol_checkpoints: [
      { checkpoint_name: "Main Gate", status: "completed" },
      { checkpoint_name: "North Wall", status: "completed" },
      { checkpoint_name: "East Gate", status: "pending" },
      { checkpoint_name: "South Gate", status: "pending" },
      { checkpoint_name: "West Gate", status: "pending" }
    ]
  },
  {
    id: 2,
    patrol_name: "Evening Rounds",
    status: "pending",
    total_checkpoints: 3,
    checkpoints_completed: 0,
    patrol_checkpoints: [
      { checkpoint_name: "Parking Lot", status: "pending" },
      { checkpoint_name: "Admin Building", status: "pending" },
      { checkpoint_name: "Warehouse", status: "pending" }
    ]
  },
  {
    id: 3,
    patrol_name: "Night Watch",
    status: "completed",
    total_checkpoints: 4,
    checkpoints_completed: 4,
    patrol_checkpoints: [
      { checkpoint_name: "Gate A", status: "completed" },
      { checkpoint_name: "Gate B", status: "completed" },
      { checkpoint_name: "Gate C", status: "completed" },
      { checkpoint_name: "Gate D", status: "completed" }
    ]
  }
];

if (USE_MOCK) {
  const mockApi = {
    post: async (url, data) => {
      console.log('API call:', url, data);
      await new Promise(r => setTimeout(r, 500));
      
      if (url === '/auth/login') {
        // Accept any email/password for testing
        return { 
          data: { 
            token: 'mock-token-12345', 
            user: { 
              id: 1, 
              email: data.email, 
              full_name: data.email.split('@')[0] || 'Test Guard', 
              user_type: 'guard' 
            } 
          } 
        };
      }
      
      if (url === '/pedestrians/entry') {
        console.log('Pedestrian registered:', data);
        return { data: { success: true, id: Date.now() } };
      }
      
      if (url === '/vehicles/entry') {
        console.log('Vehicle registered:', data);
        return { data: { success: true, id: Date.now() } };
      }
      
      if (url === '/incidents/report') {
        console.log('Incident reported:', data);
        return { data: { success: true, id: Date.now() } };
      }
      
      if (url === '/obentries') {
        console.log('OB entry created:', data);
        return { data: { success: true, id: Date.now() } };
      }
      
      return { data: {} };
    },
    
    get: async (url) => {
      console.log('API GET call:', url);
      await new Promise(r => setTimeout(r, 500));
      
      if (url === '/auth/me') {
        return { data: { id: 1, email: 'guard@nightguard.com', full_name: 'Test Guard', user_type: 'guard' } };
      }
      
      if (url === '/guard/patrols') {
        return { data: mockPatrols };
      }
      
      return { data: [] };
    }
  };

  api = {
    post: (url, data, config) => mockApi.post(url, data, config),
    get: (url, config) => mockApi.get(url, config),
    interceptors: { request: { use: () => {} }, response: { use: () => {} } }
  };
} else {
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';
  api = axios.create({ baseURL: API_URL, headers: { 'Content-Type': 'application/json' } });
  
  api.interceptors.request.use(async (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
}

// Define API functions
const login = (data) => api.post('/auth/login', data);
const getCurrentUser = () => api.get('/auth/me');
const logout = () => {
  localStorage.removeItem('token');
  return Promise.resolve();
};
const getPatrols = () => api.get('/guard/patrols');
const registerPedestrian = (data) => api.post('/pedestrians/entry', data);
const registerVehicle = (data) => api.post('/vehicles/entry', data);
const reportIncident = (data) => api.post('/incidents/report', data);
const createOBEntry = (data) => api.post('/obentries', data);

// OB-specific functions
const generateSerialNumber = async () => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const todayFormatted = today.replace(/-/g, ''); // YYYYMMDD
  const tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: entries, error } = await supabase
    .from('ob_entries')
    .select('id', { count: 'exact' })
    .gte('captured_timestamp', `${today}T00:00:00`)
    .lt('captured_timestamp', `${tomorrow}T00:00:00`);

  const count = entries?.length || 0;
  const nextNumber = count + 1;
  return `OB-${todayFormatted}-${String(nextNumber).padStart(3, '0')}`;
};

const saveOBEntry = async (natureOfOccurrence) => {
  try {
    const serialNumber = await generateSerialNumber();
    const { data, error } = await supabase
      .from('ob_entries')
      .insert({
        serial_number: serialNumber,
        nature_of_occurrence: natureOfOccurrence,
        captured_timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const getAllOBEntries = async () => {
  try {
    const { data, error } = await supabase
      .from('ob_entries')
      .select('*')
      .order('captured_timestamp', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Incident functions
const saveIncident = async (incidentData) => {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .insert({
        date_time: incidentData.dateTime,
        category: incidentData.category,
        address: incidentData.address,
        complainant_name: incidentData.complainantName,
        complainant_contact: incidentData.complainantContact,
        incident_with: incidentData.incidentWith,
        offender_address: incidentData.offenderAddress,
        offender_details: incidentData.offenderDetails,
        guard_name: incidentData.guardName,
        details: incidentData.details,
        action_taken: incidentData.actionTaken,
        vehicle_registration: incidentData.registration,
        vehicle_description: incidentData.description,
        vehicle_make_model: incidentData.makeModel,
        vehicle_vin: incidentData.vin,
        vehicle_colour: incidentData.colour,
        vehicle_license_expiry: incidentData.licenseExpiry,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const getAllIncidents = async () => {
  try {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('date_time', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export { login, getCurrentUser, logout, getPatrols, registerPedestrian, registerVehicle, reportIncident, createOBEntry, generateSerialNumber, saveOBEntry, getAllOBEntries, saveIncident, getAllIncidents };

// Default export with all functions
export default {
  api,
  login,
  getCurrentUser,
  logout,
  getPatrols,
  registerPedestrian,
  registerVehicle,
  reportIncident,
  createOBEntry,
  generateSerialNumber,
  saveOBEntry,
  getAllOBEntries,
  saveIncident,
  getAllIncidents,
};