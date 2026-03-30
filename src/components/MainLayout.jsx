import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Shield, Users, Car, AlertTriangle, BookOpen } from 'lucide-react';

export default function MainLayout() {
  const navItems = [
    { to: '/', label: 'Patrols', icon: Shield },
    { to: '/pedestrian', label: 'Person', icon: Users },
    { to: '/vehicle', label: 'Vehicle', icon: Car },
    { to: '/incident', label: 'Incident', icon: AlertTriangle },
    { to: '/obentry', label: 'OB Entry', icon: BookOpen },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <Outlet />
      </div>
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
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#000000' },
  content: { flex: 1, paddingBottom: '70px' },
  tabBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    borderTop: '1px solid #1f1f1f',
    padding: '8px 0 12px',
  },
  tab: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textDecoration: 'none',
    fontSize: '12px',
  },
  tabLabel: { marginTop: '4px', fontSize: '12px' },
};
