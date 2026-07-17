import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

let installed = false;
let keyboardVisible = false;

function setViewportHeight() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const height = window.visualViewport?.height || window.innerHeight || 0;
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
      active.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {
      // Fallback for older browsers
      active.focus();
    }
  }, 100);
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

  // Monitor viewport changes
  window.addEventListener('resize', refreshViewport);
  window.visualViewport?.addEventListener('resize', refreshViewport);

  if (!(Capacitor?.isNativePlatform?.() && Capacitor.getPlatform() === 'android')) {
    return;
  }

  // Android specific keyboard handling
  await Keyboard.addListener('keyboardDidShow', (info) => {
    setKeyboardState(true, info?.keyboardHeight || 0);
    setViewportHeight();
    scrollActiveFieldIntoView();
  });

  await Keyboard.addListener('keyboardDidHide', () => {
    setKeyboardState(false, 0);
    setViewportHeight();
    window.scrollTo(0, 0);
  });

  // Re-scroll when focus changes while keyboard is open
  document.addEventListener('focusin', ensureFormIsVisible, true);
}
