const delay = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

const dummyPatrols = [
  {
    id: 1,
    patrol_name: 'Morning Perimeter',
    status: 'in_progress',
    total_checkpoints: 5,
    checkpoints_completed: 2,
    patrol_checkpoints: [
      { checkpoint_name: 'Main Gate', status: 'completed' },
      { checkpoint_name: 'North Wall', status: 'completed' },
      { checkpoint_name: 'East Gate', status: 'pending' },
      { checkpoint_name: 'South Gate', status: 'pending' },
      { checkpoint_name: 'West Gate', status: 'pending' },
    ],
  },
  {
    id: 2,
    patrol_name: 'Evening Rounds',
    status: 'pending',
    total_checkpoints: 3,
    checkpoints_completed: 0,
    patrol_checkpoints: [
      { checkpoint_name: 'Parking Lot', status: 'pending' },
      { checkpoint_name: 'Admin Building', status: 'pending' },
      { checkpoint_name: 'Warehouse', status: 'pending' },
    ],
  },
  {
    id: 3,
    patrol_name: 'Night Watch',
    status: 'completed',
    total_checkpoints: 4,
    checkpoints_completed: 4,
    patrol_checkpoints: [
      { checkpoint_name: 'Gate A', status: 'completed' },
      { checkpoint_name: 'Gate B', status: 'completed' },
      { checkpoint_name: 'Gate C', status: 'completed' },
      { checkpoint_name: 'Gate D', status: 'completed' },
    ],
  },
];

export const mockApi = {
  login: async (email, password) => {
    await delay();
    if (email === 'guard@nightguard.com' && password === 'Guard123!') {
      return {
        token: 'mock-jwt-token-abc123',
        user: {
          id: 1,
          email,
          full_name: 'Test Guard',
          user_type: 'guard',
          site_id: 1,
        },
      };
    }
    throw new Error('Invalid credentials. Use guard@nightguard.com / Guard123!');
  },
  getMe: async () => {
    await delay(100);
    return {
      id: 1,
      email: 'guard@nightguard.com',
      full_name: 'Test Guard',
      user_type: 'guard',
      site_id: 1,
    };
  },
  getPatrols: async () => {
    await delay();
    return dummyPatrols;
  },
  registerPedestrian: async (data) => {
    await delay();
    console.log('[Mock] Register pedestrian:', data);
    return { success: true, id: Date.now() };
  },
  registerVehicle: async (data) => {
    await delay();
    console.log('[Mock] Register vehicle:', data);
    return { success: true, id: Date.now() };
  },
  reportIncident: async (data) => {
    await delay();
    console.log('[Mock] Report incident:', data);
    return { success: true, id: Date.now() };
  },
  createOBEntry: async (data) => {
    await delay();
    console.log('[Mock] OB entry:', data);
    return { success: true, id: Date.now() };
  },
};
