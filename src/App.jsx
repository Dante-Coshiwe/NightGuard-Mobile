import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './screens/LoginScreen';
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
import PatrolScheduleAlert from './components/PatrolScheduleAlert';
import SplashScreen from './components/SplashScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SetKioskPinScreen from './screens/SetKioskPinScreen';
import NotificationService from './services/notificationService';
import KioskService from './services/kioskService';
import { hasAdminPinHash } from './services/kioskPinService';

const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth() || {};
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" />;
  return children;
};

// Brief branded splash on cold launch, then fades into the app.
const BootSplash = () => {
  const [phase, setPhase] = useState('show');
  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('fade'), 1400);
    const goneTimer = setTimeout(() => setPhase('gone'), 1850);
    return () => { clearTimeout(fadeTimer); clearTimeout(goneTimer); };
  }, []);
  if (phase === 'gone') return null;
  return <SplashScreen fadingOut={phase === 'fade'} />;
};

const AppRuntimeBridge = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { shiftSession } = useAuth() || {};
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    let mounted = true;
    NotificationService.init().then(async () => {
      const permission = await NotificationService.getPermissionStatus();
      if (mounted) setPermissionDenied(permission === 'denied');
    });

    const foreground = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        window.dispatchEvent(new Event('nightguard_notifications_updated'));
        // Re-assert kiosk lock whenever the app returns to the foreground — Android may have
        // dropped screen-pinning while backgrounded.
        KioskService.ensureActive().catch(() => null);
      }
    });

    // Periodic safety net: keep the device locked while a kiosk shift is active.
    const kioskWatch = setInterval(() => {
      KioskService.ensureActive().catch(() => null);
    }, 20000);
    const back = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (window.__nightguardPatrolAlertActive) return;
      const atHome = location.pathname === '/' || location.pathname === '/patrols';
      if (!canGoBack || atHome) return;
      window.history.back();
    });
    const openPatrol = () => {
      if (location.pathname !== '/') navigate('/', { replace: false });
    };
    window.addEventListener('nightguard_open_patrol_alert', openPatrol);

    return () => {
      mounted = false;
      clearInterval(kioskWatch);
      foreground.then((handler) => handler.remove()).catch(() => null);
      back.then((handler) => handler.remove()).catch(() => null);
      window.removeEventListener('nightguard_open_patrol_alert', openPatrol);
    };
  }, [location.pathname, navigate]);

  useEffect(() => {
    let cancelled = false;
    const guardPinSetup = async () => {
      if (!shiftSession && location.pathname !== '/login' && location.pathname !== '/setup/kiosk-pin') {
        const ok = await hasAdminPinHash();
        if (!cancelled && !ok) {
          navigate('/setup/kiosk-pin', { replace: true, state: { initialSetup: true } });
        }
      }
    };
    guardPinSetup();
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate, shiftSession]);

  if (!permissionDenied || !shiftSession || !isNative) return null;

  return (
    <button
      type="button"
      onClick={() => CapacitorApp.openUrl?.({ url: 'app-settings:' }).catch(() => null)}
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 100001,
        padding: 12,
        border: '1px solid #7f1d1d',
        borderRadius: 8,
        background: '#240a0a',
        color: '#fca5a5',
        fontWeight: 700,
      }}
    >
      Notifications are disabled. Patrol alarms will only work while the app is open. Tap to open settings.
    </button>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <BootSplash />
      <BrowserRouter>
        <AuthProvider>
          <AppRuntimeBridge />
          <PatrolScheduleAlert />
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/setup/kiosk-pin" element={<ProtectedRoute><SetKioskPinScreen /></ProtectedRoute>} />
            <Route element={<ProtectedRoute><Layout><Outlet /></Layout></ProtectedRoute>}>
              <Route path="/" element={<HomeScreen />} />
              <Route path="shift" element={<ShiftManagementScreen />} />
              <Route path="guardshift" element={<ShiftScreen />} />
              <Route path="ob" element={<OBScreen />} />
              <Route path="incident" element={<IncidentScreen />} />
              <Route path="whatsapp" element={<WhatsAppScreen />} />
              <Route path="info" element={<InfoScreen />} />
              <Route path="notifications" element={<NotificationsScreen />} />
              <Route path="reports/completed-shifts" element={<CompletedShiftsReport />} />
              <Route path="reports/shift-summary" element={<ShiftSummaryReport />} />
              <Route path="reports/vehicle" element={<VehicleReport />} />
              <Route path="reports/guard-patrol" element={<GuardPatrolReport />} />
              <Route path="reports/pedestrian" element={<PedestrianReport />} />
              <Route path="config/users" element={<UsersConfig />} />
              <Route path="config/guard-patrol" element={<GuardPatrolConfig />} />
              <Route path="config/settings" element={<SettingsConfig />} />
              <Route path="config/kiosk-pin" element={<SetKioskPinScreen />} />
              <Route path="config/lookup-data" element={<LookupDataConfig />} />
            </Route>
            <Route element={<ProtectedRoute><BottomTabLayout /></ProtectedRoute>}>
              <Route path="patrols" element={<PatrolsScreen />} />
              <Route path="patrol/:id" element={<PatrolTrackingScreen />} />
              <Route path="pedestrian" element={<RegisterPedestrianScreen />} />
              <Route path="vehicle" element={<RegisterVehicleScreen />} />
              <Route path="incident" element={<ReportIncidentScreen />} />
              <Route path="obentry" element={<OBEntryScreen />} />
              <Route path="notifications" element={<NotificationsScreen />} />
              <Route path="shift" element={<ShiftScreen />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
