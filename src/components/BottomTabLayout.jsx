import React, { useState, useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Shield, Car, Footprints, AlertTriangle, BookOpen, Menu, X, Clock } from 'lucide-react';

export default function BottomTabLayout() {
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setSidebarOpen(false); // Close sidebar on desktop
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const navItems = [
    { to: '/patrols', label: 'Patrols', icon: Shield },
    { to: '/pedestrian', label: 'Person', icon: Footprints },
    { to: '/vehicle', label: 'Vehicle', icon: Car },
    { to: '/incident', label: 'Incident', icon: AlertTriangle },
    { to: '/obentry', label: 'OB', icon: BookOpen },
  ];

  return (
    <div style={styles.container}>
      {/* Mobile Sidebar Overlay */}
      {isMobile && sidebarOpen && (
        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      {isMobile && (
        <div style={{
          ...styles.mobileSidebar,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)'
        }}>
          <div style={styles.sidebarHeader}>
            <h3 style={styles.sidebarTitle}>Navigation</h3>
            <button
              onClick={() => setSidebarOpen(false)}
              style={styles.closeButton}
            >
              <X size={24} />
            </button>
          </div>
          <div style={styles.sidebarContent}>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                style={({ isActive }) => ({
                  ...styles.sidebarLink,
                  backgroundColor: isActive ? '#dc2626' : 'transparent',
                })}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={styles.mainContent}>
        {/* Mobile Header with Menu Button */}
        {isMobile && (
          <div style={styles.mobileHeader}>
            <button
              onClick={() => setSidebarOpen(true)}
              style={styles.menuButton}
            >
              <Menu size={24} />
            </button>
            <h1 style={styles.mobileTitle}>Night Guard</h1>
          </div>
        )}

        {/* Content Container */}
        <div style={styles.content}>
          <Outlet />
        </div>
      </div>

      {/* Bottom Tab Bar (Desktop only or when sidebar closed on mobile) */}
      {!isMobile && (
        <div style={styles.tabBar}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                ...styles.tab,
                color: isActive ? '#dc2626' : '#666666',
              })}
            >
              <item.icon size={24} />
              <span style={styles.tabLabel}>{item.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    backgroundColor: '#000000'
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column'
  },
  mobileHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '16px 20px',
    backgroundColor: '#0a0a0a',
    borderBottom: '1px solid #1f1f1f',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  menuButton: {
    background: 'none',
    border: 'none',
    color: '#dc2626',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  mobileTitle: {
    color: '#ffffff',
    fontSize: '18px',
    fontWeight: 'bold',
    margin: 0,
    marginLeft: '16px'
  },
  content: {
    flex: 1,
    padding: '20px',
    maxWidth: '480px',
    margin: '0 auto',
    width: '100%',
    paddingBottom: '90px' // Extra padding for mobile bottom spacing
  },
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 200
  },
  mobileSidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '280px',
    height: '100vh',
    backgroundColor: '#0a0a0a',
    borderRight: '1px solid #1f1f1f',
    zIndex: 300,
    transition: 'transform 0.3s ease',
    display: 'flex',
    flexDirection: 'column'
  },
  sidebarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px',
    borderBottom: '1px solid #1f1f1f'
  },
  sidebarTitle: {
    color: '#ffffff',
    fontSize: '18px',
    fontWeight: 'bold',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#666666',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '6px'
  },
  sidebarContent: {
    flex: 1,
    padding: '20px 0'
  },
  sidebarLink: {
    display: 'flex',
    alignItems: 'center',
    padding: '16px 20px',
    color: '#ffffff',
    textDecoration: 'none',
    border: 'none',
    background: 'none',
    width: '100%',
    cursor: 'pointer',
    fontSize: '16px',
    gap: '12px',
    transition: 'background-color 0.2s ease'
  },
  tabBar: {
  position: 'fixed',
  bottom: 0,
  left: 20,
  right: 0,
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  backgroundColor: '#0a0a0a',
  borderTop: '1px solid #1f1f1f',
  padding: '12px 0 16px',
  zIndex: 9999, // Increased to ensure it's above the sidebar

  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textDecoration: 'none',
    fontSize: '12px',
    padding: '8px 12px', // Added padding for larger touch targets
    borderRadius: '8px',
    minHeight: '60px', // Minimum touch target size
    minWidth: '60px',
    justifyContent: 'center'
  },
  tabLabel: {
    marginTop: '4px',
    fontSize: '12px'
  }
};
