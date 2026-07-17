import React from 'react';
import { NIGHTGUARD_LOGO } from '../lib/nightguardLogo';

// Full-screen dark branded splash / loading overlay. Pure CSS, self-contained, works offline.
export default function SplashScreen({ fadingOut = false }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200000,
        background: '#06070a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        opacity: fadingOut ? 0 : 1,
        transition: 'opacity 420ms ease',
        pointerEvents: fadingOut ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes ng-splash-pulse { 0%,100% { opacity: .6; transform: scale(.98);} 50% { opacity: 1; transform: scale(1);} }
        @keyframes ng-splash-bar { 0% { transform: translateX(-120%);} 100% { transform: translateX(120%);} }
      `}</style>
      <img
        src={NIGHTGUARD_LOGO}
        alt="NightGuard"
        style={{ width: 200, maxWidth: '62%', height: 'auto', animation: 'ng-splash-pulse 1.8s ease-in-out infinite' }}
      />
      <div style={{ color: '#8b95a5', fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' }}>
        Night-Guard Security
      </div>
      <div style={{ width: 120, height: 3, borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: '50%',
            background: 'linear-gradient(90deg, transparent, #ff3547, transparent)',
            animation: 'ng-splash-bar 1.1s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  );
}
