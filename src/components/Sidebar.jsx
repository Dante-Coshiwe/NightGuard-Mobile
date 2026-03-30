import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X, Home, BookOpen, AlertTriangle, MessageCircle, Info, FileText, Settings, Users, Shield, ChevronDown, ChevronRight } from 'lucide-react';

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [openReports, setOpenReports] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);

  const toggleSidebar = () => setIsOpen(!isOpen);
  const toggleReports = () => setOpenReports(!openReports);
  const toggleConfig = () => setOpenConfig(!openConfig);

  const menuItems = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/ob', label: 'OB', icon: BookOpen },
    { to: '/incident', label: 'Incident', icon: AlertTriangle },
    { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { to: '/info', label: 'Info', icon: Info },
    {
      label: 'Reports',
      icon: FileText,
      subItems: [
        { to: '/reports/completed-shifts', label: 'Completed Shifts Report' },
        { to: '/reports/shift-summary', label: 'Shift Summary Report' },
        { to: '/reports/vehicle', label: 'Vehicle Report' },
        { to: '/reports/guard-patrol', label: 'Guard Patrol Report' },
        { to: '/reports/pedestrian', label: 'Pedestrian Report' },
      ]
    },
    {
      label: 'Configurations',
      icon: Settings,
      subItems: [
        { to: '/config/users', label: 'Users' },
        { to: '/config/guard-patrol', label: 'Guard Patrol' },
        { to: '/config/settings', label: 'Settings' },
        { to: '/config/lookup-data', label: 'Lookup Data' },
      ]
    },
  ];

  return (
    <>
      <button onClick={toggleSidebar} style={styles.toggleBtn}>
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
      <div style={{ ...styles.sidebar, width: isOpen ? '280px' : '0px', overflow: isOpen ? 'visible' : 'hidden' }}>
        <div style={styles.logo}>
          <span style={styles.logoText}>NightGuard</span>
        </div>
        <nav style={styles.nav}>
          {menuItems.map((item, idx) => (
            <div key={idx}>
              {item.subItems ? (
                <div>
                  <button onClick={item.label === 'Reports' ? toggleReports : toggleConfig} style={styles.menuButton}>
                    <item.icon size={20} />
                    <span style={styles.menuLabel}>{item.label}</span>
                    {item.label === 'Reports' ? (openReports ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : (openConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                  </button>
                  <div style={{ ...styles.subMenu, display: (item.label === 'Reports' ? openReports : openConfig) ? 'block' : 'none' }}>
                    {item.subItems.map((sub, subIdx) => (
                      <NavLink key={subIdx} to={sub.to} style={({ isActive }) => ({ ...styles.subLink, backgroundColor: isActive ? '#dc2626' : 'transparent' })}>
                        {sub.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ) : (
                <NavLink to={item.to} style={({ isActive }) => ({ ...styles.link, backgroundColor: isActive ? '#dc2626' : 'transparent' })}>
                  <item.icon size={20} />
                  <span style={styles.menuLabel}>{item.label}</span>
                </NavLink>
              )}
            </div>
          ))}
        </nav>
      </div>
    </>
  );
};

const styles = {
  toggleBtn: {
    position: 'fixed',
    top: '20px',
    left: '20px',
    zIndex: 1001,
    background: '#0a0a0a',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    padding: '8px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    height: '100vh',
    background: '#0a0a0a',
    transition: 'width 0.3s',
    overflowX: 'hidden',
    zIndex: 1000,
    borderRight: '1px solid #1f1f1f',
  },
  logo: {
    padding: '24px 20px',
    borderBottom: '1px solid #1f1f1f',
  },
  logoText: {
    color: '#fff',
    fontSize: '20px',
    fontWeight: 'bold',
  },
  nav: {
    padding: '20px 12px',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    marginBottom: '8px',
    borderRadius: '8px',
    color: '#fff',
    textDecoration: 'none',
    transition: 'background 0.2s',
  },
  menuButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '12px 16px',
    marginBottom: '8px',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '16px',
    textAlign: 'left',
  },
  menuLabel: {
    flex: 1,
    marginLeft: '12px',
  },
  subMenu: {
    marginLeft: '36px',
    marginBottom: '8px',
  },
  subLink: {
    display: 'block',
    padding: '8px 16px',
    marginBottom: '4px',
    borderRadius: '6px',
    color: '#ccc',
    textDecoration: 'none',
    fontSize: '14px',
  },
};

export default Sidebar;