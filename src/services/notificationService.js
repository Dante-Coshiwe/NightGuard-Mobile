import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';

const FEED_KEY = 'app_notifications';
const PERMISSION_KEY = 'notifications_permission';
const SCHEDULE_KEY = 'patrol_notification_schedule';
const CHANNEL_ID = 'patrol_alerts';
const MAX_FEED_ITEMS = 200;
let listenersRegistered = false;

const isNative = () => Capacitor.isNativePlatform?.() === true;

async function prefGet(key, fallback = null) {
  try {
    const { value } = await Preferences.get({ key });
    if (value !== null && value !== undefined) return value;
  } catch (err) {
    console.warn('[NotificationService] Preferences read failed:', err?.message || err);
  }
  return localStorage.getItem(key) ?? fallback;
}

async function prefSet(key, value) {
  const next = String(value);
  localStorage.setItem(key, next);
  try {
    await Preferences.set({ key, value: next });
  } catch (err) {
    console.warn('[NotificationService] Preferences write failed:', err?.message || err);
  }
}

function safeJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function stablePatrolNotificationId(time, index = 0) {
  const clean = String(time || '').replace(':', '');
  const numeric = Number(clean);
  return Number.isFinite(numeric) ? 200000 + numeric : 200000 + index;
}

function nextOccurrenceForTime(time, from = new Date()) {
  const [hours, minutes] = String(time).split(':').map(Number);
  const at = new Date(from);
  at.setHours(hours || 0, minutes || 0, 0, 0);
  if (at <= from) at.setDate(at.getDate() + 1);
  return at;
}

function dispatchFeedUpdated() {
  window.dispatchEvent(new Event('nightguard_notifications_updated'));
}

export async function hashPin(pin) {
  const value = String(pin || '');
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buf)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return `legacy_${Math.abs(hash)}`;
}

const NotificationService = {
  async init() {
    try {
      if (isNative()) {
        await LocalNotifications.createChannel({
          id: CHANNEL_ID,
          name: 'Patrol Alerts',
          description: 'Mandatory patrol start alarms',
          importance: 5,
          visibility: 1,
          vibration: true,
          lights: true,
          lightColor: '#FF0000',
          sound: 'patrol_alarm',
        });

        const permission = await LocalNotifications.requestPermissions();
        const display = permission?.display || permission?.receive || 'prompt';
        await prefSet(PERMISSION_KEY, display === 'granted' ? 'granted' : 'denied');

        if (!listenersRegistered) {
          listenersRegistered = true;
          LocalNotifications.addListener('localNotificationReceived', async (notification) => {
            const patrolTime = notification?.extra?.patrolTime;
            if (notification?.extra?.type === 'patrol_alarm') {
              await NotificationService.addToAppNotificationFeed({
                type: 'patrol_alarm',
                title: 'Patrol alarm triggered',
                body: `Scheduled patrol ${patrolTime || ''} is due now`.trim(),
                metadata: notification.extra || {},
              });
              await NotificationService.rescheduleNextPatrolOccurrence(patrolTime);
              window.dispatchEvent(new CustomEvent('nightguard_open_patrol_alert', {
                detail: { patrolTime, notificationId: notification?.id },
              }));
            }
          });

          LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
            const data = event?.notification?.extra || {};
            if (data.type === 'patrol_alarm') {
              window.dispatchEvent(new CustomEvent('nightguard_open_patrol_alert', {
                detail: { patrolTime: data.patrolTime, notificationId: data.notificationId || event?.notification?.id },
              }));
            }
          });
        }
      } else {
        await prefSet(PERMISSION_KEY, 'granted');
      }
    } catch (err) {
      console.warn('[NotificationService] init failed:', err?.message || err);
      await prefSet(PERMISSION_KEY, 'denied');
    }
  },

  async getPermissionStatus() {
    return prefGet(PERMISSION_KEY, 'prompt');
  },

  async getPatrolSchedule() {
    return safeJson(await prefGet(SCHEDULE_KEY, '{}'), {});
  },

  async savePatrolSchedule(schedule) {
    await prefSet(SCHEDULE_KEY, JSON.stringify(schedule || {}));
  },

  getNotificationIdForPatrolTime(time, index = 0) {
    return stablePatrolNotificationId(time, index);
  },

  async schedulePatrolAlarm(patrolTime, patrolLabel = '', notificationId = null) {
    const id = notificationId || stablePatrolNotificationId(patrolTime);
    const at = nextOccurrenceForTime(patrolTime);
    const title = 'Patrol due now';
    const body = patrolLabel || `Scheduled patrol ${patrolTime} must start now`;

    if (isNative()) {
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title,
          body,
          schedule: { at, allowWhileIdle: true },
          sound: 'patrol_alarm.wav',
          channelId: CHANNEL_ID,
          extra: { type: 'patrol_alarm', patrolTime, notificationId: id },
        }],
      });
    }

    const current = await this.getPatrolSchedule();
    current[patrolTime] = {
      notificationId: id,
      patrolTime,
      label: patrolLabel || `Patrol ${patrolTime}`,
      nextFireAt: at.toISOString(),
      channelId: CHANNEL_ID,
      enabled: true,
    };
    await this.savePatrolSchedule(current);
    return current[patrolTime];
  },

  async cancelNotification(id) {
    if (!id) return;
    if (isNative()) {
      await LocalNotifications.cancel({ notifications: [{ id: Number(id) }] }).catch((err) => {
        console.warn('[NotificationService] cancel failed:', err?.message || err);
      });
    }
  },

  async cancelAllPatrolNotifications() {
    const schedule = await this.getPatrolSchedule();
    const notifications = Object.values(schedule)
      .map((entry) => Number(entry.notificationId))
      .filter((id) => Number.isFinite(id))
      .map((id) => ({ id }));

    if (notifications.length && isNative()) {
      await LocalNotifications.cancel({ notifications }).catch((err) => {
        console.warn('[NotificationService] cancel all failed:', err?.message || err);
      });
    }
    await this.savePatrolSchedule({});
  },

  async scheduleAllDailyPatrols(patrolTimes = []) {
    const validTimes = Array.from(new Set((patrolTimes || [])
      .map((time) => String(time || '').trim())
      .filter((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time))))
      .sort();

    await this.cancelAllPatrolNotifications();
    const entries = {};
    for (const [index, time] of validTimes.entries()) {
      entries[time] = await this.schedulePatrolAlarm(time, `Scheduled patrol ${time}`, stablePatrolNotificationId(time, index));
    }
    return entries;
  },

  async rescheduleNextPatrolOccurrence(patrolTime) {
    if (!patrolTime) return null;
    const schedule = await this.getPatrolSchedule();
    const existing = schedule[patrolTime];
    return this.schedulePatrolAlarm(
      patrolTime,
      existing?.label || `Scheduled patrol ${patrolTime}`,
      existing?.notificationId || stablePatrolNotificationId(patrolTime)
    );
  },

  async showImmediateNotification(title, body, id = Date.now() % 2147483647, metadata = {}) {
    if (isNative()) {
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title,
          body,
          schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
          channelId: CHANNEL_ID,
          extra: metadata,
        }],
      }).catch((err) => console.warn('[NotificationService] immediate notification failed:', err?.message || err));
    }
    return this.addToAppNotificationFeed({
      type: metadata.type || 'system',
      title,
      body,
      metadata: { ...metadata, notificationId: id },
    });
  },

  // Ping fired the moment a patrol point is captured (NFC or GPS), so the guard gets
  // audible/visible confirmation without looking at the screen.
  async announceCheckpointCaptured(checkpointName, metadata = {}) {
    const name = checkpointName || 'Checkpoint';
    return this.showImmediateNotification(
      'Patrol point gathered',
      `${name} patrol point has been gathered`,
      Date.now() % 2147483647,
      { ...metadata, type: 'checkpoint_captured', checkpointName: name }
    );
  },

  async addToAppNotificationFeed(entry = {}) {
    const current = await this.getAppNotifications();
    const next = [{
      id: entry.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: entry.type || 'system',
      title: entry.title || 'Notification',
      body: entry.body || '',
      timestamp: entry.timestamp || new Date().toISOString(),
      read: Boolean(entry.read),
      metadata: entry.metadata || {},
    }, ...current].slice(0, MAX_FEED_ITEMS);

    await prefSet(FEED_KEY, JSON.stringify(next));
    dispatchFeedUpdated();
    return next[0];
  },

  async getAppNotifications() {
    const entries = safeJson(await prefGet(FEED_KEY, '[]'), []);
    return Array.isArray(entries) ? entries : [];
  },

  async getUnreadCount() {
    const entries = await this.getAppNotifications();
    return entries.filter((entry) => !entry.read).length;
  },

  async markAsRead(id) {
    const entries = await this.getAppNotifications();
    const next = entries.map((entry) => String(entry.id) === String(id) ? { ...entry, read: true } : entry);
    await prefSet(FEED_KEY, JSON.stringify(next));
    dispatchFeedUpdated();
    return next;
  },

  async clearAll() {
    await prefSet(FEED_KEY, '[]');
    dispatchFeedUpdated();
  },
};

export default NotificationService;
