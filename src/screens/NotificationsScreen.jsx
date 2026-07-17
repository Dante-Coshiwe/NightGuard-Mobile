import React, { useEffect, useState } from 'react';
import NotificationService from '../services/notificationService';
import './screens.css';

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState([]);

  const loadNotifications = async () => {
    setNotifications(await NotificationService.getAppNotifications());
  };

  useEffect(() => {
    loadNotifications();
    window.addEventListener('nightguard_notifications_updated', loadNotifications);
    return () => window.removeEventListener('nightguard_notifications_updated', loadNotifications);
  }, []);

  const markAsRead = async (id) => {
    setNotifications(await NotificationService.markAsRead(id));
  };

  const clearAll = async () => {
    await NotificationService.clearAll();
    setNotifications([]);
  };

  return (
    <div className="screen-container notifications-screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h1 className="form-title" style={{ margin: 0 }}>Notifications</h1>
        <button type="button" className="button-submit" style={{ width: 'auto', padding: '10px 14px' }} onClick={clearAll}>
          Clear all
        </button>
      </div>

      {notifications.length === 0 ? (
        <div style={{ color: '#777', textAlign: 'center', padding: 40 }}>No notifications yet</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {notifications.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => markAsRead(entry.id)}
              style={{
                textAlign: 'left',
                padding: 14,
                background: entry.read ? '#0a0a0a' : 'rgba(220, 38, 38, 0.12)',
                border: '1px solid #1f1f1f',
                borderLeft: entry.read ? '3px solid #333' : '3px solid #dc2626',
                borderRadius: 8,
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div style={{ fontWeight: entry.read ? 600 : 900 }}>{entry.title}</div>
                {!entry.read && <span style={{ width: 8, height: 8, borderRadius: 999, background: '#dc2626', flex: '0 0 auto' }} />}
              </div>
              {entry.body && <div style={{ color: '#c7c7c7', fontSize: 13, marginTop: 6 }}>{entry.body}</div>}
              <div style={{ color: '#777', fontSize: 11, marginTop: 8 }}>{formatTimestamp(entry.timestamp)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
