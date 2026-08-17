import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu, X, Home, BookOpen, AlertTriangle, MessageCircle,
  Info, FileText, Settings, ChevronDown, ChevronRight, Bell,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getDeviceId, getLocationName } from '../lib/deviceStore';
import { NIGHTGUARD_LOGO } from '../lib/nightguardLogo';
import EndShiftModal from './EndShiftModal';
import NotificationService from '../services/notificationService';

// Handsets with a physically damaged screen area behind the floating menu button.
//
// This is a hardware fault on one specific device, not a layout bug: the wheatek WP20 at Sibaya
// Sands (NG-5CB273608D76D247) has a dead patch down the right-hand side of its screen, and the
// guard was rotating the phone every time to reach the menu. The damaged strip runs a long way
// down — 34px was tried first and was still inside it — so on that handset the button sits at the
// vertical middle of the screen instead.
//
// The value is whatever CSS `top` should be, so a percentage is fine; anything truthy here also
// gets translateY(-50%) so a percentage centres the button rather than starting it there.
//
// It is keyed by device id rather than shipped fleet-wide because nothing is wrong with the layout
// anywhere else, and OTA cannot target one handset: `ota_device_assignments` exists in the schema
// but the deployed `ota-check` never reads it (verified 2026-08-17 — a device pinned to 1.0.2 was
// still served the newest production bundle). The resolver keys off orgId only. So the bundle goes
// to everyone and the offset picks its own device out.
//
// If that handset is repaired or retired, delete its entry. Add to it the same way if another
// screen fails.
const DAMAGED_SCREEN_MENU_TOP = {
  'NG-5CB273608D76D247': '50%',
};

const Sidebar = ({ isOpen, toggleSidebar, isMobile }) => {
  const { user, logout, shiftSession } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.user_type === 'admin';
  const [openReports, setOpenReports] = useState(false);
  const [openConfig,  setOpenConfig]  = useState(false);
  const location = useLocation();

  // 10 everywhere except the handsets in DAMAGED_SCREEN_MENU_TOP. getDeviceId() is a synchronous
  // cache read, and an unresolved id simply yields the default.
  const menuTopOverride = DAMAGED_SCREEN_MENU_TOP[getDeviceId()] || null;
  const menuTop = menuTopOverride ?? 10;

  // Picking a page closes the menu on its own — no reaching for the X. Tapping the page you are
  // already on leaves it open, because that was not an attempt to go anywhere.
  const normalisePath = (path) => (path === '/' ? '/' : String(path || '').replace(/\/+$/, ''));
  const closeAfterNavigating = (to) => {
    if (!isOpen) return;
    if (normalisePath(to) === normalisePath(location.pathname)) return;
    toggleSidebar();
  };
  const [unreadCount, setUnreadCount] = useState(0);
  const [showEndShift, setShowEndShift] = useState(false);
  const locationName = getLocationName();

  React.useEffect(() => {
    const refresh = () => NotificationService.getUnreadCount().then(setUnreadCount).catch(() => setUnreadCount(0));
    refresh();
    window.addEventListener('nightguard_notifications_updated', refresh);
    return () => window.removeEventListener('nightguard_notifications_updated', refresh);
  }, []);

  const guardOnlyItems = [
    { to: '/',         label: 'Home',      icon: Home },
    { to: '/ob',       label: 'OB',        icon: BookOpen },
    { to: '/incident', label: 'Incident',  icon: AlertTriangle },
    { to: '/whatsapp', label: 'WhatsApp',  icon: MessageCircle },
    { to: '/info',     label: 'Info',      icon: Info },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
  ];

  const adminItems = [
    { to: '/',          label: 'Home',     icon: Home },
    { to: '/ob',        label: 'OB',       icon: BookOpen },
    { to: '/incident',  label: 'Incident', icon: AlertTriangle },
    { to: '/whatsapp',  label: 'WhatsApp', icon: MessageCircle },
    { to: '/info',      label: 'Info',     icon: Info },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: unreadCount },
    {
      label: 'Reports',
      icon: FileText,
      subItems: [
        { to: '/reports/completed-shifts', label: 'Completed Shifts' },
        { to: '/reports/shift-summary',    label: 'Shift Summary' },
        { to: '/reports/vehicle',          label: 'Vehicle Report' },
        { to: '/reports/guard-patrol',     label: 'Guard Patrol' },
        { to: '/reports/pedestrian',       label: 'Pedestrian Report' },
      ],
    },
    {
      label: 'Configurations',
      icon: Settings,
      subItems: [
        { to: '/config/users',        label: 'Users' },
        { to: '/config/guard-patrol', label: 'Guard Patrol' },
        { to: '/config/settings',     label: 'Settings' },
        { to: '/config/lookup-data',  label: 'Lookup Data' },
      ],
    },
  ];

  const menuItems = isAdmin ? adminItems : guardOnlyItems;

  // ── On mobile the sidebar is always position:fixed and full-height.
  // ── On desktop it's also fixed but collapses to 70px icon rail.
  const sidebarWidth = isOpen ? 280 : (isMobile ? 0 : 70);

  return (
    <>
      {showEndShift && (
        <EndShiftModal
          activeShift={shiftSession}
          onClose={() => setShowEndShift(false)}
          onEnded={() => setShowEndShift(false)}
        />
      )}
      {/* ── Mobile hamburger — top-right, above everything including the banner ── */}
      {isMobile && !isOpen && (
        <button
          onClick={toggleSidebar}
          style={{
            position:        'fixed',
            top:             menuTop,
            // Centres the button on a percentage `top`; absent for the default 10px.
            ...(menuTopOverride ? { transform: 'translateY(-50%)' } : null),
            right:           14,        // right edge — never overlaps left content
            left:            'auto',
            zIndex:          9999,      // above the banner (98) so it's always tappable
            background:      'rgba(10,10,10,0.92)',
            border:          '1px solid rgba(255,255,255,0.12)',
            borderRadius:    8,
            color:           '#fff',
            cursor:          'pointer',
            padding:         '6px 8px',
            display:         'flex',
            alignItems:      'center',
            backdropFilter:  'blur(8px)',
          }}
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
      )}

      <aside
        style={{
          width:           sidebarWidth,
          minWidth:        sidebarWidth,
          // Overlay: always fixed, sits above content
          position:        'fixed',
          top:             0,
          left:            0,
          height:          '100vh',
          zIndex:          100,
          // Slightly translucent so you can tell content is behind it
          background:      isOpen
            ? 'rgba(10, 10, 10, 0.96)'
            : 'rgba(10, 10, 10, 0.92)',
          backdropFilter:  'blur(12px)',
          borderRight:     isOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
          transition:      'none',
          animation:       'none',
          overflowX:       'hidden',
          overflowY:       'auto',
          display:         'flex',
          flexDirection:   'column',
          // Hide completely on mobile when closed (width 0)
          visibility:      (!isMobile || isOpen) ? 'visible' : 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding:       '20px 16px',
          display:       'flex',
          justifyContent:'space-between',
          alignItems:    'center',
          borderBottom:  '1px solid rgba(255,255,255,0.08)',
          flexShrink:    0,
        }}>
          {isOpen && (
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {locationName}
              </div>
              <img
                src={NIGHTGUARD_LOGO}
                alt="Night-Guard Security"
                style={{ display: 'block', width: 118, maxWidth: '100%', height: 'auto', marginTop: 6 }}
              />
            </div>
          )}
          <button
            onClick={toggleSidebar}
            style={{
              background: 'transparent',
              border:     'none',
              color:      '#fff',
              cursor:     'pointer',
              padding:    4,
              display:    'flex',
              alignItems: 'center',
              marginLeft: isOpen ? 0 : 'auto',
              marginRight:isOpen ? 0 : 'auto',
            }}
            aria-label={isOpen ? 'Close menu' : 'Open menu'}
          >
            {isOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* ── User info (open state only) ── */}
        {isOpen && user && (
          <div style={{
            padding:      '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            background:   'rgba(220,38,38,0.08)',
            flexShrink:   0,
          }}>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
              {user.full_name || user.email}
            </div>
            <div style={{ color: '#dc2626', fontSize: 11, textTransform: 'uppercase', marginTop: 2 }}>
              {user.user_type}
            </div>
          </div>
        )}

        {/* ── Nav ── */}
        <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
          {menuItems.map((item, idx) => (
            <div key={idx}>
              {item.subItems ? (
                <div>
                  <button
                    onClick={() =>
                      item.label === 'Reports'
                        ? setOpenReports((p) => !p)
                        : setOpenConfig((p) => !p)
                    }
                    style={{
                      display:        'flex',
                      alignItems:     'center',
                      justifyContent: 'space-between',
                      width:          '100%',
                      padding:        '11px 14px',
                      marginBottom:   3,
                      background:     'transparent',
                      border:         'none',
                      borderRadius:   8,
                      color:          '#ccc',
                      cursor:         'pointer',
                      fontSize:       14,
                      whiteSpace:     'nowrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <item.icon size={19} />
                      {isOpen && <span>{item.label}</span>}
                    </div>
                    {isOpen && (
                      item.label === 'Reports'
                        ? (openReports ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
                        : (openConfig  ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
                    )}
                  </button>

                  {(item.label === 'Reports' ? openReports : openConfig) && isOpen && (
                    <div style={{ marginLeft: 28, marginBottom: 6 }}>
                      {item.subItems.map((sub, subIdx) => (
                        <NavLink
                          key={subIdx}
                          to={sub.to}
                          onClick={() => closeAfterNavigating(sub.to)}
                          style={({ isActive }) => ({
                            display:         'block',
                            padding:         '8px 14px',
                            marginBottom:    2,
                            borderRadius:    6,
                            color:           isActive ? '#fff' : '#888',
                            textDecoration:  'none',
                            fontSize:        13,
                            backgroundColor: isActive ? '#dc2626' : 'transparent',
                            whiteSpace:      'nowrap',
                          })}
                        >
                          {sub.label}
                        </NavLink>
                      ))}
                    </div>
                  )}

                  {/* Icon-only collapsed sub-items on desktop */}
                  {!isOpen && !isMobile && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginBottom: 4 }}>
                      {item.subItems.map((sub, subIdx) => (
                        <NavLink
                          key={subIdx}
                          to={sub.to}
                          title={sub.label}
                          onClick={() => closeAfterNavigating(sub.to)}
                          style={({ isActive }) => ({
                            display:         'flex',
                            alignItems:      'center',
                            justifyContent:  'center',
                            width:           36,
                            height:          28,
                            borderRadius:    6,
                            color:           isActive ? '#fff' : '#555',
                            textDecoration:  'none',
                            fontSize:        10,
                            backgroundColor: isActive ? '#dc2626' : 'transparent',
                          })}
                        >
                          {sub.label.charAt(0)}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => closeAfterNavigating(item.to)}
                  style={({ isActive }) => ({
                    display:         'flex',
                    alignItems:      'center',
                    gap:             10,
                    padding:         '11px 14px',
                    marginBottom:    3,
                    borderRadius:    8,
                    color:           isActive ? '#fff' : '#ccc',
                    textDecoration:  'none',
                    fontSize:        14,
                    backgroundColor: isActive ? '#dc2626' : 'transparent',
                    whiteSpace:      'nowrap',
                    justifyContent:  isOpen ? 'flex-start' : 'center',
                  })}
                  title={!isOpen ? item.label : undefined}
                >
                  <item.icon size={19} />
                  {isOpen && <span>{item.label}</span>}
                  {isOpen && item.badge > 0 && (
                    <span style={{ marginLeft: 'auto', minWidth: 20, padding: '2px 6px', borderRadius: 999, background: '#dc2626', color: '#fff', fontSize: 11, textAlign: 'center' }}>
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              )}
            </div>
          ))}
        </nav>

        {/* ── Logout / unbind ── */}
        <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <button
            onClick={async () => {
              if (shiftSession?.id) {
                setShowEndShift(true);
                return;
              }
              await logout();
              navigate('/login', { replace: true });
            }}
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: isOpen ? 'flex-start' : 'center',
              gap:            10,
              width:          '100%',
              padding:        '11px 14px',
              background:     'transparent',
              border:         '1px solid rgba(255,255,255,0.08)',
              borderRadius:   8,
              color:          '#666',
              cursor:         'pointer',
              fontSize:       13,
              whiteSpace:     'nowrap',
            }}
            title={!isOpen ? 'Logout' : undefined}
          >
            <span style={{ fontSize: 16 }}></span>
            {isOpen && <span>{shiftSession?.id ? 'Exit Kiosk' : 'Logout'}</span>}
          </button>
        </div>
      </aside>

      {/* ── Desktop spacer — pushes content right when sidebar is a fixed rail ── */}
      {!isMobile && (
        <div style={{
          width:      sidebarWidth,
          minWidth:   sidebarWidth,
          flexShrink: 0,
          transition: 'none',
        }} />
      )}
    </>
  );
};

export default Sidebar;
