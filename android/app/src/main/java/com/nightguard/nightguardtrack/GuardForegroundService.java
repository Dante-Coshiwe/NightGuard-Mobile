package com.nightguard.nightguardtrack;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class GuardForegroundService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, MainActivity.GUARD_SERVICE_CHANNEL_ID)
            .setContentTitle("Guard Session Active")
            .setContentText("Tap to return to NightGuard")
            .setSmallIcon(getApplicationInfo().icon)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(openAppIntent())
            .build();

        startForeground(1001, notification);
        return START_STICKY;
    }

    /**
     * This notification is on screen for the whole shift, so it is the one dependable way back
     * into the app after a sanctioned trip out to WhatsApp — it is visible from inside WhatsApp
     * itself, which Recents is not. It had no content intent at all until 1.21: tapping "Guard
     * Session Active" did nothing, and the guard was left hunting for the launcher icon.
     *
     * Same flags as PatrolTrackingService.openAppIntent: MainActivity is launchMode="singleTask",
     * so this brings the existing task forward rather than starting a second copy of the shift.
     */
    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
