import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './screens/LoginScreen';
import Sidebar from './components/Sidebar';
import BottomTabLayout from './components/BottomTabLayout';
import ErrorBoundary from './components/ErrorBoundary';
import HomeScreen from './screens/HomeScreen';
import OBScreen from './screens/OBScreen';
import IncidentScreen from './screens/IncidentScreen';
import WhatsAppScreen from './screens/WhatsAppScreen';
import InfoScreen from './screens/InfoScreen';
import CompletedShiftsReport from './screens/CompletedShiftsReport';
import ShiftSummaryReport from './screens/ShiftSummaryReport';
import VehicleReport from './screens/VehicleReport';
import GuardPatrolReport from './screens/GuardPatrolReport';
import PedestrianReport from './screens/PedestrianReport';
import UsersConfig from './screens/UsersConfig';
import GuardPatrolConfig from './screens/GuardPatrolConfig';
import SettingsConfig from './screens/SettingsConfig';
import LookupDataConfig from './screens/LookupDataConfig';
import PatrolsScreen from './screens/PatrolsScreen';
import PatrolTrackingScreen from './screens/PatrolTrackingScreen';
import RegisterPedestrianScreen from './screens/RegisterPedestrianScreen';
import RegisterVehicleScreen from './screens/RegisterVehicleScreen';
import ReportIncidentScreen from './screens/ReportIncidentScreen';
import OBEntryScreen from './screens/OBEntryScreen';
import ShiftManagementScreen from './screens/ShiftManagementScreen';
import Layout from './components/Layout';
import ShiftScreen from './screens/ShiftScreen';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ background: '#000', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
};

/*const SidebarLayout = () => {
  return (
    <div style={{ display: 'flex', position: 'relative' }}>
      <Sidebar />
      <div style={{ flex: 1, minHeight: '100vh', backgroundColor: '#000', width: '100%' }}>
        <Outlet />
      </div>
    </div>
  );
};*/

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            {/* Sidebar Layout for admin/report pages */}
            <Route element={<ProtectedRoute><Layout><Outlet /></Layout></ProtectedRoute>}>
              <Route path="/" element={<HomeScreen />} />
              {/* Shift Management */}
              <Route path="shift" element={<ShiftManagementScreen />} />
              <Route path="guardshift" element={<ShiftScreen />} />
              <Route path="ob" element={<OBScreen />} />
              <Route path="incident" element={<IncidentScreen />} />
              <Route path="whatsapp" element={<WhatsAppScreen />} />
              <Route path="info" element={<InfoScreen />} />
              {/* Reports */}
              <Route path="reports/completed-shifts" element={<CompletedShiftsReport />} />
              <Route path="reports/shift-summary" element={<ShiftSummaryReport />} />
              <Route path="reports/vehicle" element={<VehicleReport />} />
              <Route path="reports/guard-patrol" element={<GuardPatrolReport />} />
              <Route path="reports/pedestrian" element={<PedestrianReport />} />
              {/* Configurations */}
              <Route path="config/users" element={<UsersConfig />} />
              <Route path="config/guard-patrol" element={<GuardPatrolConfig />} />
              <Route path="config/settings" element={<SettingsConfig />} />
              <Route path="config/lookup-data" element={<LookupDataConfig />} />
              {/* Shift Management */}
            </Route>
            {/* Bottom Tab Layout for core guard functions */}
            <Route element={<ProtectedRoute><BottomTabLayout /></ProtectedRoute>}>
              <Route path="patrols" element={<PatrolsScreen />} />
              <Route path="patrol/:id" element={<PatrolTrackingScreen />} />
              <Route path="pedestrian" element={<RegisterPedestrianScreen />} />
              <Route path="vehicle" element={<RegisterVehicleScreen />} />
              <Route path="incident" element={<ReportIncidentScreen />} />
              <Route path="obentry" element={<OBEntryScreen />} />
              <Route path="shift" element={<ShiftScreen />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
