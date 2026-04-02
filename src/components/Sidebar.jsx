import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X, Home, BookOpen, AlertTriangle, MessageCircle, Info, FileText, Settings, ChevronDown, ChevronRight, Clock } from 'lucide-react';

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const [openReports, setOpenReports] = useState(false);
  const [openConfig, setOpenConfig] = useState(false);

  const toggleReports = () => setOpenReports(!openReports);
  const toggleConfig = () => setOpenConfig(!openConfig);

  const menuItems = [
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
    <aside
      style={{
        width: isOpen ? 280 : 70,
        background: 'rgba(10, 10, 10, 0.85)',
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
      }}
    >
      <div style={{ padding: '20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        {isOpen && <span style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>NightGuard</span>}
        <button
          onClick={toggleSidebar}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      <nav style={{ padding: '20px 12px' }}>
        {menuItems.map((item, idx) => (
          <div key={idx}>
            {item.subItems ? (
              <div>
                <button
                  onClick={item.label === 'Reports' ? toggleReports : toggleConfig}
                  style={{
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
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <item.icon size={20} />
                    {isOpen && <span>{item.label}</span>}
                  </div>
                  {isOpen && (item.label === 'Reports' ? (openReports ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : (openConfig ? <ChevronDown size={16} /> : <ChevronRight size={16} />))}
                </button>
                <div style={{ marginLeft: isOpen ? '36px' : '0', display: (item.label === 'Reports' ? openReports : openConfig) ? 'block' : 'none' }}>
                  {item.subItems.map((sub, subIdx) => (
                    <NavLink
                      key={subIdx}
                      to={sub.to}
                      style={({ isActive }) => ({
                        display: 'block',
                        padding: '8px 16px',
                        marginBottom: '4px',
                        borderRadius: '6px',
                        color: '#ccc',
                        textDecoration: 'none',
                        fontSize: '14px',
                        backgroundColor: isActive ? '#dc2626' : 'transparent',
                      })}
                    >
                      {isOpen ? sub.label : sub.label.charAt(0)}
                    </NavLink>
                  ))}
                </div>
              </div>
            ) : (
              <NavLink
                to={item.to}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  marginBottom: '8px',
                  borderRadius: '8px',
                  color: '#fff',
                  textDecoration: 'none',
                  backgroundColor: isActive ? '#dc2626' : 'transparent',
                })}
              >
                <item.icon size={20} />
                {isOpen && <span>{item.label}</span>}
              </NavLink>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;