import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import OfflineBanner from './OfflineBanner';

const MOBILE_BREAKPOINT = 768;

const Layout = ({ children }) => {
  const isMobileInit = typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
  const [sidebarOpen, setSidebarOpen] = useState(!isMobileInit); // closed by default on mobile
  const [isMobile, setIsMobile]       = useState(isMobileInit);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      // Auto-close when resizing down to mobile
      if (mobile) setSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar  = () => setSidebarOpen(false);

  return (
    <div style={{ display: 'flex', minHeight: 'var(--app-viewport-height, 100dvh)', backgroundColor: '#000', position: 'relative' }}>
      <OfflineBanner />

      {/* ── Backdrop (mobile only, shown when sidebar is open) ── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={closeSidebar}
          style={{
            position:        'fixed',
            inset:           0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            backdropFilter:  'blur(2px)',
            zIndex:          99,
          }}
        />
      )}

      <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} isMobile={isMobile} />

      <main
        style={{
          flex:       1,
          // On mobile: no margin shift — sidebar overlays content
          // On desktop: push content to the right as before
          marginLeft:  isMobile ? 0 : (sidebarOpen ? 280 : 70),
          transition: 'none',
          minHeight:  'var(--app-viewport-height, 100dvh)',
          // Prevent content from being hidden under a collapsed sidebar on desktop
          minWidth:   0,
          overflowX:  'hidden',
        }}
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;
