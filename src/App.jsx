import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginScreen from './screens/LoginScreen';
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
import ShiftManagementScreen from './screens/ShiftManagementScreen';
import Layout from './components/Layout';
import ShiftScreen from './screens/ShiftScreen';
import PatrolScheduleAlert from './components/PatrolScheduleAlert';
import PatrolRecorder from './components/PatrolRecorder';
import SplashScreen from './components/SplashScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SetKioskPinScreen from './screens/SetKioskPinScreen';
import SelectSiteScreen from './screens/SelectSiteScreen';
import NotificationService from './services/notificationService';
import KioskService from './services/kioskService';
import { hasAdminPinHash } from './services/kioskPinService';
import { ensureDeviceRecord } from './services/schemaData';
import { markAppBackgrounded, reconcileAppDeparture } from './lib/appDepartureLog';

const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

const ProtectedRoute = ({ children }) => {
  const { user, loading, needsSiteBinding } = useAuth() || {};
  const location = useLocation();
  if (loading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" />;
  // A device that does not know its site cannot record anything correctly, so
  // nothing else is reachable until it is bound. Devices already bound — every
  // device currently in the field — never see this.
  if (needsSiteBinding && location.pathname !== '/setup/site') {
    return <Navigate to="/setup/site" replace />;
  }
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
  const { user, shiftSession, needsSiteBinding } = useAuth() || {};
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Read by the appStateChange listener below. A ref, not a dependency: re-subscribing the
  // lifecycle listeners every time the signed-in user changes would risk missing a departure.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    let mounted = true;
    NotificationService.init().then(async () => {
      const permission = await NotificationService.getPermissionStatus();
      if (mounted) setPermissionDenied(permission === 'denied');
    });

    // A departure is only worth reporting once we know how long it lasted, so leaving marks the
    // moment locally and returning decides whether it was a real absence. See appDepartureLog.
    reconcileAppDeparture();

    const foreground = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        window.dispatchEvent(new Event('nightguard_notifications_updated'));
        // Re-assert kiosk lock whenever the app returns to the foreground — Android may have
        // dropped screen-pinning while backgrounded.
        KioskService.ensureActive().catch(() => null);
        reconcileAppDeparture();
      } else {
        markAppBackgrounded({ user: userRef.current });
      }
    });

    // Periodic safety net: keep the device locked while a kiosk shift is active.
    const kioskWatch = setInterval(() => {
      KioskService.ensureActive().catch(() => null);
    }, 20000);
    const back = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (window.__nightguardPatrolAlertActive) return;
      const atHome = location.pathname === '/';
      if (!canGoBack || atHome) return;
      window.history.back();
    });
    // ALWAYS carry the tab in the navigation state. This handler and PatrolScheduleAlert both react
    // to the same event, so whichever navigates last decides which tab HomeScreen opens on — a
    // stateless navigate here landed the guard on Pedestrians with the alarm sounding behind it.
    // Navigating even when already at '/' is deliberate: it is what switches the tab.
    const openPatrol = () => navigate('/', { state: { tab: 'patrols' }, replace: false });
    window.addEventListener('nightguard_open_patrol_alert', openPatrol);

    return () => {
      mounted = false;
      clearInterval(kioskWatch);
      foreground.then((handler) => handler.remove()).catch(() => null);
      back.then((handler) => handler.remove()).catch(() => null);
      window.removeEventListener('nightguard_open_patrol_alert', openPatrol);
    };
  }, [location.pathname, navigate]);

  // Put this handset in the `devices` table as soon as its site is known, so the dashboard can
  // show which device is bound where.
  //
  // Registration used to ride along inside recordDeviceSyncLog, which only runs when the offline
  // queue actually had something to drain. A device that is simply healthy and online never has a
  // queue to drain, so it never registered and the roster stayed empty — being well-behaved was
  // exactly what kept a phone invisible. It must not depend on there being unsynced work.
  useEffect(() => {
    if (needsSiteBinding) return undefined;

    let cancelled = false;
    // Cheap to repeat: returns immediately once the device is in the cached site settings.
    const register = () => {
      if (!cancelled) ensureDeviceRecord().catch(() => null);
    };

    register();
    // Also on resume — the first launch after install often has no site binding or no network yet.
    const resumed = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) register();
    });

    return () => {
      cancelled = true;
      resumed.then((handler) => handler.remove()).catch(() => null);
    };
  }, [needsSiteBinding]);

  useEffect(() => {
    let cancelled = false;
    const guardPinSetup = async () => {
      // The kiosk PIN is set per site, so it waits until the site is known.
      if (needsSiteBinding) return;
      if (!shiftSession && !['/login', '/setup/kiosk-pin', '/setup/site'].includes(location.pathname)) {
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
  }, [location.pathname, navigate, shiftSession, needsSiteBinding]);

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
          <PatrolRecorder />
          <PatrolScheduleAlert />
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/setup/site" element={<ProtectedRoute><SelectSiteScreen /></ProtectedRoute>} />
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
            {/* Anything unknown (an old deep link, a stale notification) belongs on the home
                screen rather than on a blank page. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
