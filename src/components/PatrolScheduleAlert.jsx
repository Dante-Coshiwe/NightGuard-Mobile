import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Preferences } from '@capacitor/preferences';
import { useAuth } from '../contexts/AuthContext';
import { getCachedSiteSettings, getPatrolConfig, getShiftSession } from '../lib/deviceStore';
import { getBoundSiteIdSync } from '../lib/siteResolver';
import { getPatrolDue, raisePatrolDue } from '../lib/patrolDueAlarm';
import NotificationService from '../services/notificationService';

// Watches the patrol schedule and, when one comes due, sends the guard to the Patrol tab with the
// alarm sounding. It renders nothing.
//
// It used to throw up a full-screen modal with its own Start Patrol button. That took the guard
// away from the patrol UI to a screen that existed only to be dismissed. Now the due state and the
// alarm live in lib/patrolDueAlarm, the guard lands on the ordinary Patrol tab, and the real Start
// Patrol button flashes and keeps making noise until it is pressed.

function formatMinute(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export default function PatrolScheduleAlert() {
  const navigate = useNavigate();
  const { user, shiftSession } = useAuth();
  const armedRef = useRef('');

  // Keep the OS-level daily alarms armed.
  //
  // Two things made them silently disappear. Android drops an app's alarms on reinstall, so every
  // APK upgrade disarmed the whole schedule; and they were only ever set when a shift was created
  // or the patrol config was saved, so nothing ever put them back. This is deliberately NOT gated
  // on an active shift — the times are a property of the site's schedule, and whether a guard is on
  // duty is decided when the alarm fires, not when it is armed. scheduleAllDailyPatrols cancels
  // before it schedules, so re-running it is harmless.
  useEffect(() => {
    const armAlarms = () => {
      const config = getPatrolConfig();
      if (config.patrolScheduleEnabled === false) return;

      const times = Array.isArray(config.patrolTimes) ? config.patrolTimes : [];
      const signature = times.join(',');
      if (!times.length || armedRef.current === signature) return;
      armedRef.current = signature;

      NotificationService.scheduleAllDailyPatrols(times)
        .then(() => console.info(`[PatrolAlert] armed ${times.length} daily patrol alarm(s): ${signature}`))
        .catch((err) => {
          armedRef.current = '';
          console.warn('[PatrolAlert] could not arm patrol alarms:', err?.message || err);
        });
    };

    armAlarms();
    window.addEventListener('nightguard_patrol_config_updated', armAlarms);
    return () => window.removeEventListener('nightguard_patrol_config_updated', armAlarms);
  }, []);

  useEffect(() => {
    const raise = async ({ patrolTime, notificationId }) => {
      // Anyone signed in on this device gets the alarm — an active shift is NOT required.
      //
      // The OS notification fires regardless of shift state (it is armed from the site's schedule,
      // not from a shift), so gating only the in-app half produced the worst possible outcome: the
      // phone made the noise and the app did nothing — no siren, no announcement, no flashing
      // button, and the guard left staring at whatever screen they were on. Shift bookkeeping is
      // recorded when the patrol starts; it must never decide whether the alarm is heard.
      const activeShift = shiftSession || getShiftSession();
      if ((!user && !activeShift) || getPatrolDue()) return;

      const siteId = getBoundSiteIdSync() || getCachedSiteSettings().id || activeShift?.siteId || null;
      raisePatrolDue({
        time: patrolTime,
        notificationId: notificationId || NotificationService.getNotificationIdForPatrolTime(patrolTime),
        siteId,
        shiftId: activeShift?.id || null,
        guardId: activeShift?.activeGuardId || user?.id || null,
        guardName: activeShift?.activeGuardName || user?.full_name || 'Active Guard',
      });
      // Straight to the patrol screen — no intermediate alert to dismiss.
      navigate('/', { state: { tab: 'patrols' }, replace: false });
    };

    // In-app fallback for a device sitting on the patrol screen when the minute ticks over. The
    // OS alarm is the real mechanism; this only catches the case where the app is already open.
    const checkSchedule = async () => {
      const activeShift = shiftSession || getShiftSession();
      if ((!user && !activeShift) || getPatrolDue()) return;

      const config = getPatrolConfig();
      if (config.patrolScheduleEnabled === false) return;

      const now = new Date();
      const currentTime = formatMinute(now);
      const patrolTimes = Array.isArray(config.patrolTimes) ? config.patrolTimes : [];
      if (!patrolTimes.includes(currentTime)) return;

      const siteId = getBoundSiteIdSync() || getCachedSiteSettings().id || activeShift?.siteId || null;
      const triggerKey = `nightguard_patrol_triggered_${siteId || 'site'}_${formatDateKey(now)}_${currentTime}`;
      const { value } = await Preferences.get({ key: triggerKey }).catch(() => ({ value: localStorage.getItem(triggerKey) }));
      if (value === 'true') return;

      await Preferences.set({ key: triggerKey, value: 'true' }).catch(() => localStorage.setItem(triggerKey, 'true'));
      await raise({ patrolTime: currentTime });
    };

    const handleNativePatrolAlert = (event) => raise({
      patrolTime: event?.detail?.patrolTime || formatMinute(new Date()),
      notificationId: event?.detail?.notificationId,
    });

    checkSchedule();
    const intervalId = window.setInterval(checkSchedule, 60 * 1000);
    window.addEventListener('nightguard_open_patrol_alert', handleNativePatrolAlert);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('nightguard_open_patrol_alert', handleNativePatrolAlert);
    };
  }, [shiftSession, user, navigate]);

  return null;
}
