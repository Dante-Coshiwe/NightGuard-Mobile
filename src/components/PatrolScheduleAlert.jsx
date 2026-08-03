import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { useAuth } from '../contexts/AuthContext';
import { useOfflineApi } from '../hooks/useOfflineApi';
import { syncOfflineQueueNow } from '../hooks/useOfflineQueue';
import { getCachedSiteSettings, getPatrolConfig, getShiftSession, upsertCachedPatrol } from '../lib/deviceStore';
import { getActivePatrolSession, startPatrolSession } from '../lib/patrolSession';
import NotificationService from '../services/notificationService';

function formatMinute(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function startAlarm() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return () => {};

  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.6, context.currentTime + 0.08);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();

  let high = true;
  const intervalId = window.setInterval(() => {
    high = !high;
    oscillator.frequency.setValueAtTime(high ? 880 : 660, context.currentTime);
  }, 450);

  return () => {
    window.clearInterval(intervalId);
    try {
      oscillator.stop();
      context.close();
    } catch {
      // Already stopped.
    }
  };
}

async function setKeepAwake(active) {
  try {
    const keepAwake = window.Capacitor?.Plugins?.KeepAwake;
    if (!keepAwake) return;
    if (active) {
      await keepAwake.keepAwake();
    } else {
      await keepAwake.allowSleep();
    }
  } catch (err) {
    console.warn('[PatrolAlert] KeepAwake unavailable:', err?.message || err);
  }
}

export default function PatrolScheduleAlert() {
  const navigate = useNavigate();
  const { user, shiftSession } = useAuth();
  const { post, isOnline } = useOfflineApi();
  const [duePatrol, setDuePatrol] = useState(null);
  const stopAlarmRef = useRef(null);

  useEffect(() => {
    const checkSchedule = async () => {
      const activeShift = shiftSession || getShiftSession();
      if (!activeShift?.id || duePatrol) return;

      const config = getPatrolConfig();
      if (config.patrolScheduleEnabled === false) return;

      const now = new Date();
      const currentTime = formatMinute(now);
      const patrolTimes = Array.isArray(config.patrolTimes) ? config.patrolTimes : [];
      if (!patrolTimes.includes(currentTime)) return;

      const siteId = getCachedSiteSettings().id || activeShift.siteId || null;
      const triggerKey = `nightguard_patrol_triggered_${siteId || 'site'}_${formatDateKey(now)}_${currentTime}`;
      const { value } = await Preferences.get({ key: triggerKey }).catch(() => ({ value: localStorage.getItem(triggerKey) }));
      if (value === 'true') return;

      await Preferences.set({ key: triggerKey, value: 'true' }).catch(() => localStorage.setItem(triggerKey, 'true'));
      setDuePatrol({
        time: currentTime,
        notificationId: NotificationService.getNotificationIdForPatrolTime(currentTime),
        siteId,
        shiftId: activeShift.id,
        guardId: activeShift.activeGuardId || user?.id || null,
        guardName: activeShift.activeGuardName || user?.full_name || 'Active Guard',
      });
    };

    checkSchedule();
    const intervalId = window.setInterval(checkSchedule, 60 * 1000);
    const handleNativePatrolAlert = async (event) => {
      const activeShift = shiftSession || getShiftSession();
      const patrolTime = event?.detail?.patrolTime || formatMinute(new Date());
      if (!activeShift?.id || duePatrol) return;

      const siteId = getCachedSiteSettings().id || activeShift.siteId || null;
      await NotificationService.addToAppNotificationFeed({
        type: 'patrol_alarm',
        title: 'Patrol alarm triggered',
        body: `Scheduled patrol ${patrolTime} is due now.`,
        metadata: { patrolTime, notificationId: event?.detail?.notificationId, shiftId: activeShift.id },
      });
      setDuePatrol({
        time: patrolTime,
        notificationId: event?.detail?.notificationId || NotificationService.getNotificationIdForPatrolTime(patrolTime),
        siteId,
        shiftId: activeShift.id,
        guardId: activeShift.activeGuardId || user?.id || null,
        guardName: activeShift.activeGuardName || user?.full_name || 'Active Guard',
      });
    };
    window.addEventListener('nightguard_patrol_config_updated', checkSchedule);
    window.addEventListener('nightguard_open_patrol_alert', handleNativePatrolAlert);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('nightguard_patrol_config_updated', checkSchedule);
      window.removeEventListener('nightguard_open_patrol_alert', handleNativePatrolAlert);
    };
  }, [duePatrol, shiftSession, user]);

  useEffect(() => {
    if (!duePatrol) return undefined;
    window.__nightguardPatrolAlertActive = true;
    stopAlarmRef.current = startAlarm();
    setKeepAwake(true);
    const backHandler = CapacitorApp.addListener('backButton', () => undefined);

    return () => {
      window.__nightguardPatrolAlertActive = false;
      stopAlarmRef.current?.();
      stopAlarmRef.current = null;
      setKeepAwake(false);
      backHandler.then((handler) => handler.remove()).catch(() => null);
    };
  }, [duePatrol]);

  const handleStartPatrol = async () => {
    if (!duePatrol) return;

    const config = getPatrolConfig();
    const requiredCount = config.checkpoints.filter((checkpoint) => checkpoint.required !== false).length
      || config.minimumTagCount
      || 1;

    // Open the same durable patrol session the Patrol tab and <PatrolRecorder /> work from. The
    // alarm used to mint a loose patrol id and hand off to a separate tracking screen that never
    // opened a session, so an alarm-started patrol recorded no route and never completed.
    // A patrol already in progress is resumed, never overwritten — that would discard its route.
    const session = getActivePatrolSession() || startPatrolSession({
      siteId: duePatrol.siteId,
      shiftId: duePatrol.shiftId,
      guardId: duePatrol.guardId,
      guardName: duePatrol.guardName,
      requiredCount,
    });

    const patrolId = session.id;
    const now = new Date().toISOString();
    const patrol = {
      id: patrolId,
      site_id: duePatrol.siteId,
      shift_id: duePatrol.shiftId,
      guard_id: null,
      local_guard_id: duePatrol.guardId,
      patrol_name: `Scheduled Patrol ${duePatrol.time}`,
      actual_start: session.startedAt,
      status: 'in_progress',
      created_at: now,
      updated_at: now,
      guard_name: duePatrol.guardName,
      _offline: true,
      total_checkpoints: config.checkpoints.length,
      checkpoints_completed: 0,
    };

    stopAlarmRef.current?.();
    stopAlarmRef.current = null;
    await setKeepAwake(false);
    setDuePatrol(null);
    upsertCachedPatrol(patrol);
    await NotificationService.cancelNotification(duePatrol.notificationId || NotificationService.getNotificationIdForPatrolTime(duePatrol.time));
    await NotificationService.rescheduleNextPatrolOccurrence(duePatrol.time);
    await NotificationService.addToAppNotificationFeed({
      type: 'patrol_start',
      title: 'Patrol started',
      body: `Scheduled patrol ${duePatrol.time} started.`,
      metadata: { patrolId, shiftId: duePatrol.shiftId, patrolTime: duePatrol.time },
    });

    try {
      await post('/patrols/start', patrol, {
        clientTempId: patrolId,
        forceQueue: true,
        offlineResponse: patrol,
      });
      if (isOnline) syncOfflineQueueNow().catch(() => null);
    } catch (err) {
      console.error('[PatrolAlert] Patrol start queued with warning:', err?.message || err);
    }

    // Land on the app's own Patrol tab — same screen "Start Patrol" opens by hand — instead of a
    // separate tracking screen with its own navigation.
    navigate('/', { state: { tab: 'patrols' }, replace: false });
  };

  if (!duePatrol) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        background: '#120000',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    >
      <div style={{ width: 'min(92vw, 460px)', textAlign: 'center' }}>
        <div style={{ color: '#fca5a5', fontSize: 13, fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase', marginBottom: 12 }}>
          Patrol Due Now
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: 34, lineHeight: 1.05 }}>Scheduled Patrol {duePatrol.time}</h1>
        <p style={{ margin: '0 0 28px', color: '#fecaca', fontSize: 16 }}>
          Start the patrol to stop the alarm.
        </p>
        <button
          type="button"
          onClick={handleStartPatrol}
          style={{
            width: '100%',
            minHeight: 76,
            border: 'none',
            borderRadius: 8,
            background: '#dc2626',
            color: '#fff',
            fontSize: 24,
            fontWeight: 900,
            cursor: 'pointer',
            boxShadow: '0 0 0 8px rgba(220, 38, 38, 0.24)',
          }}
        >
          Start Patrol
        </button>
      </div>
    </div>
  );
}
