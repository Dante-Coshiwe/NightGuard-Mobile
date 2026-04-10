import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X, Home, BookOpen, AlertTriangle, MessageCircle, Info, FileText, Settings, ChevronDown, ChevronRight, Clock, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const { user, logout } = useAuth();
  const isAdmin = user?.user_type === 'admin';
  const [openReports, setOpenReports] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);

  const guardOnlyItems = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/ob', label: 'OB', icon: BookOpen },
    { to: '/incident', label: 'Incident', icon: AlertTriangle },
    { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { to: '/info', label: 'Info', icon: Info },
  ];

  const adminItems = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/guardshift', label: 'Shift', icon: Clock },
    { to: '/ob', label: 'OB', icon: BookOpen },
    { to: '/incident', label: 'Incident', icon: AlertTriangle },
    { to: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
    { to: '/info', label: 'Info', icon: Info },
    {
      label: 'Reports',
      icon: FileText,
      subItems: [
        { to: '/reports/completed-shifts', label: 'Completed Shifts' },
        { to: '/reports/shift-summary', label: 'Shift Summary' },
        { to: '/reports/vehicle', label: 'Vehicle Report' },
        { to: '/reports/guard-patrol', label: 'Guard Patrol' },
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

  const menuItems = isAdmin ? adminItems : guardOnlyItems;

  return (
    <aside style={{
      width: isOpen ? 280 : 70,
      background: 'rgba(10, 10, 10, 0.95)',
      backdropFilter: 'blur(10px)',
      borderRight: '1px solid rgba(255, 255, 255, 0.1)',
      transition: 'width 0.3s ease',
      overflowX: 'hidden',
      overflowY: 'auto',
      position: 'fixed',
      top: 0,
      left: 0,
      height: '100vh',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {isOpen && <span style={{ color: '#fff', fontSize: '18px', fontWeight: 'bold' }}>NightGuard</span>}
        <button onClick={toggleSidebar} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* User info */}
      {isOpen && user && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(220,38,38,0.1)' }}>
          <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{user.full_name || user.email}</div>
          <div style={{ color: '#dc2626', fontSize: 11, textTransform: 'uppercase', marginTop: 2 }}>{user.user_type}</div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ padding: '16px 12px', flex: 1 }}>
        {menuItems.map((item, idx) => (
          <div key={idx}>
            {item.subItems ? (
              <div>
                <button
                  onClick={() => item.label === 'Reports' ? setOpenReports(!openReports) : setOpenConfig(!openConfig)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '12px 16px', marginBottom: '4px', background: 'transparent', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '15px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <item.icon size={20} />
                    {isOpen && <span>{item.label}</span>}
                  </div>
                  {isOpen && (item.label === 'Reports'
                    ? (openReports ? <ChevronDown size={16} /> : <ChevronRight size={16} />)
                    : (openConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />)
                  )}
                </button>
                {(item.label === 'Reports' ? openReports : openConfig) && (
                  <div style={{ marginLeft: isOpen ? '32px' : '0', marginBottom: 8 }}>
                    {item.subItems.map((sub, subIdx) => (
                      <NavLink key={subIdx} to={sub.to}
                        style={({ isActive }) => ({
                          display: 'block', padding: '8px 16px', marginBottom: '2px',
                          borderRadius: '6px', color: isActive ? '#fff' : '#aaa',
                          textDecoration: 'none', fontSize: '13px',
                          backgroundColor: isActive ? '#dc2626' : 'transparent',
                        })}>
                        {isOpen ? sub.label : sub.label.charAt(0)}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <NavLink to={item.to}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', marginBottom: '4px', borderRadius: '8px',
                  color: '#fff', textDecoration: 'none',
                  backgroundColor: isActive ? '#dc2626' : 'transparent',
                })}>
                <item.icon size={20} />
                {isOpen && <span>{item.label}</span>}
              </NavLink>
            )}
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div style={{ padding: '16px 12px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={logout}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '12px 16px', background: 'transparent', border: '1px solid #333', borderRadius: '8px', color: '#999', cursor: 'pointer', fontSize: '14px' }}>
          <span style={{ fontSize: 18 }}>⏻</span>
          {isOpen && <span>{user?.user_type === 'guard' ? 'End Shift & Logout' : 'Logout'}</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;