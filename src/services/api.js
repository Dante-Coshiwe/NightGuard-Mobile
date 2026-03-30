import { mockApi } from './mockApi';

const USE_REAL_API = false;
const BASE_URL = 'http://192.168.1.100:4000/api';

const mock = {
  post: async (url, data) => {
    if (url === '/auth/login') {
      const res = await mockApi.login(data.email, data.password);
      return { data: res };
    }
    if (url === '/pedestrians/entry') return { data: await mockApi.registerPedestrian(data) };
    if (url === '/vehicles/entry') return { data: await mockApi.registerVehicle(data) };
    if (url === '/incidents/report') return { data: await mockApi.reportIncident(data) };
    if (url === '/obentries') return { data: await mockApi.createOBEntry(data) };
    return { data: {} };
  },
  get: async (url) => {
    if (url === '/guard/patrols') return { data: await mockApi.getPatrols() };
    if (url === '/auth/me') return { data: await mockApi.getMe() };
    return { data: [] };
  },
};

let real = null;
if (USE_REAL_API) {
  const axios = require('axios').default;
  real = axios.create({
    baseURL: BASE_URL,
    headers: { 'Content-Type': 'application/json' },
  });
}

const api = USE_REAL_API ? real : mock;
export default api;
