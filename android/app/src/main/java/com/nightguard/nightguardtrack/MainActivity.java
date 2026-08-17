package com.nightguard.nightguardtrack;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    public static final String GUARD_SERVICE_CHANNEL_ID = "guard_service";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        // Background patrol recording. Only this shell has it; the shared web bundle
        // feature-detects it and falls back to the in-app GPS watch on older installs.
        registerPlugin(PatrolTrackerPlugin.class);
        // Native tag reading. Web NFC (NDEFReader) does not exist in a WebView, so without this
        // plugin NFC check-ins cannot fire at all inside the APK.
        registerPlugin(NfcReaderPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        applyImmersiveBlackBars();
        // Must run AFTER super.onCreate(): it replaces a listener the SystemBars plugin
        // installs while the bridge is loading its plugins.
        applyLegacyKeyboardInsetFix();

        createGuardServiceChannel();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-assert after Capacitor's edge-to-edge setup so the bars stay black.
        applyImmersiveBlackBars();
    }

    /**
     * Android 14 and below subtract the keyboard TWICE. The gap shows as a black bar.
     *
     * Capacitor 8's SystemBars plugin installs an OnApplyWindowInsetsListener on the WebView's
     * parent and pads it by imeInsets.bottom whenever the IME is visible — see
     * initWindowInsetsListener() in the plugin. Under the forced edge-to-edge layout of
     * Android 15+ that is correct and necessary: the window is NOT resized there, so the app
     * has to make room for the keyboard itself.
     *
     * Below API 35 the window is not edge-to-edge, so android:windowSoftInputMode="adjustResize"
     * has ALREADY shrunk it to the space above the keyboard. Padding by the IME inset on top of
     * that subtracts the keyboard a second time, and the strip that opens up exposes the decor
     * background — which applyImmersiveBlackBars() paints Color.BLACK. Hence a black bar between
     * the content and the keyboard, on old handsets ONLY. Reported on OUKITEL WP5 / Android 10;
     * the same build is correct on Android 15+, which is why it looked device-specific.
     *
     * So: re-install the listener with the IME term dropped, on API < 35 only.
     *
     * ⚠ The two config knobs that look like they control this are BOTH dead on Capacitor 8, and
     * turning them is what made two earlier attempts at this fail:
     *   • `android.adjustMarginsForEdgeToEdge` was removed after Capacitor 7 — the key is not
     *     read anywhere in @capacitor/android 8.x, so "auto" and "force" are the same no-op.
     *   • `plugins.Keyboard.resizeOnFullScreen` still parses, but Keyboard.possiblyResizeChildOfContent()
     *     returns immediately when the SystemBars class is on the classpath, which in Capacitor 8
     *     it always is.
     * There is no web-layer workaround either: the bar is outside the WebView. Do not go looking
     * for one in CSS. This fix ships in the APK only — an OTA bundle cannot carry it.
     */
    private void applyLegacyKeyboardInsetFix() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            return;
        }

        final Bridge activeBridge = getBridge();
        if (activeBridge == null || activeBridge.getWebView() == null) {
            return;
        }
        if (!(activeBridge.getWebView().getParent() instanceof View)) {
            return;
        }
        final View webViewParent = (View) activeBridge.getWebView().getParent();

        ViewCompat.setOnApplyWindowInsetsListener(webViewParent, (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            // Type.ime() is deliberately absent. The window is already sized to sit above the
            // keyboard; adding it here is the double subtraction described above.
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);

            // Zero the consumed insets rather than returning CONSUMED, which breaks safe-area
            // recalculation in the WebView — same reason the plugin does it this way.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(),
                    Insets.of(0, 0, 0, 0)
                )
                .build();
        });

        webViewParent.requestApplyInsets();
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
