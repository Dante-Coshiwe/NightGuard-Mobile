import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

let installed = false;
let keyboardVisible = false;

function isNativeAndroid() {
  return Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android';
}

function setViewportHeight() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // On Android the native window is already resized by adjustResize / Capacitor's
  // fullscreen workaround. visualViewport is unreliable on older Android WebViews
  // while the IME is animating, and using it here can double-shrink the app.
  const height = isNativeAndroid()
    ? window.innerHeight || document.documentElement.clientHeight || 0
    : window.visualViewport?.height || window.innerHeight || 0;
  document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(height)}px`);
}

function setKeyboardState(isOpen, keyboardHeight = 0) {
  if (typeof document === 'undefined') return;

  keyboardVisible = isOpen;
  document.body.classList.toggle('keyboard-open', isOpen);
  document.documentElement.style.setProperty('--keyboard-height', `${Math.max(0, Math.round(keyboardHeight))}px`);
}

function scrollActiveFieldIntoView() {
  const active = document.activeElement;
  if (!active || typeof active.scrollIntoView !== 'function') return;

  window.setTimeout(() => {
    try {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {
      // Fallback for older browsers.
      active.focus();
    }
  }, 120);
}

function ensureFormIsVisible() {
  if (keyboardVisible) {
    window.setTimeout(() => scrollActiveFieldIntoView(), 150);
  }
}

export async function installMobileKeyboardWorkarounds() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  installed = true;
  setViewportHeight();
  setKeyboardState(false, 0);

  const refreshViewport = () => {
    setViewportHeight();
    if (keyboardVisible) {
      ensureFormIsVisible();
    }
  };

  window.addEventListener('resize', refreshViewport);
  window.visualViewport?.addEventListener('resize', refreshViewport);

  if (!isNativeAndroid()) {
    return;
  }

  await Keyboard.addListener('keyboardDidShow', (info) => {
    setKeyboardState(true, info?.keyboardHeight || 0);
    setViewportHeight();
    scrollActiveFieldIntoView();
  });

  await Keyboard.addListener('keyboardDidHide', () => {
    setKeyboardState(false, 0);
    setViewportHeight();
  });

  document.addEventListener('focusin', ensureFormIsVisible, true);
}
