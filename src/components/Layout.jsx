import React, { useState } from 'react';
import Sidebar from './Sidebar';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar isOpen={sidebarOpen} toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <main
        style={{
          flex: 1,
          marginLeft: sidebarOpen ? 280 : 70,
          transition: 'margin-left 0.3s ease',
          backgroundColor: '#000000',
          minHeight: '100vh',
        }}
      >
        {children}
      </main>
    </div>
  );
};

export default Layout;