package com.nightguard.nightguardtrack;

import com.getcapacitor.BridgeActivity;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    public static final String GUARD_SERVICE_CHANNEL_ID = "guard_service";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        // Background patrol recording. Only this shell has it; the shared web bundle
        // feature-detects it and falls back to the in-app GPS watch on older installs.
        registerPlugin(PatrolTrackerPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        applyImmersiveBlackBars();

        createGuardServiceChannel();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-assert after Capacitor's edge-to-edge setup so the bars stay black.
        applyImmersiveBlackBars();
    }

    /**
     * Paint the status and navigation bars solid black with light (white) icons so
     * the app blends into its dark UI instead of showing the system's grey bars.
     */
    private void applyImmersiveBlackBars() {
        final Window window = getWindow();
        final View decor = window.getDecorView();
        decor.post(() -> {
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            // The forced edge-to-edge layout leaves the WebView inset; the strips
            // behind the transparent system bars show the decor background, so make
            // it black to blend the bars into the app's dark UI.
            decor.setBackgroundColor(Color.BLACK);
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, decor);
            if (controller != null) {
                controller.setAppearanceLightStatusBars(false);
                controller.setAppearanceLightNavigationBars(false);
            }
        });
    }

    public void startKioskMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            startLockTask();
        }
    }

    public void stopKioskMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            stopLockTask();
        }
    }

    private void createGuardServiceChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                GUARD_SERVICE_CHANNEL_ID,
                "Guard Session",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps the guard session active");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }
}
