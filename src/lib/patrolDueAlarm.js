// A scheduled patrol that has come due, and the alarm that keeps sounding until the guard starts it.
//
// This lives outside React because the alarm has to outlive the component that raised it: the guard
// is sent to the Patrol tab and the noise must keep going there, stopping only when Start Patrol is
// actually pressed. Previously a full-screen alert owned the sound, so the alarm and the button
// that silenced it were the same throwaway screen — the guard was routed away from the patrol UI to
// a modal, which is exactly what we no longer want.

const EVENT = 'nightguard_patrol_due_changed';

let duePatrol = null;
let stopSound = null;

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

// A square-wave two-tone siren through WebAudio. Deliberately not an <audio> file: this has to
// sound with the app in any state and needs no asset to load before it can be heard.
function startSound() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return () => {};

  const context = new AudioContextCtor();
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
    if (active) await keepAwake.keepAwake();
    else await keepAwake.allowSleep();
  } catch (err) {
    console.warn('[PatrolDue] KeepAwake unavailable:', err?.message || err);
  }
}

export function getPatrolDue() {
  return duePatrol;
}

export function subscribePatrolDue(listener) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Raise a due patrol and start the alarm. Ignored if one is already sounding. */
export function raisePatrolDue(info) {
  if (duePatrol) return;
  duePatrol = info || {};
  // Read by the shell to suppress anything that would steal focus while the alarm is up.
  window.__nightguardPatrolAlertActive = true;
  stopSound = startSound();
  setKeepAwake(true);
  emit();
}

/** Silence the alarm — only ever called because the guard pressed Start Patrol. */
export function clearPatrolDue() {
  if (!duePatrol) return null;
  const cleared = duePatrol;
  duePatrol = null;
  window.__nightguardPatrolAlertActive = false;
  stopSound?.();
  stopSound = null;
  setKeepAwake(false);
  emit();
  return cleared;
}
