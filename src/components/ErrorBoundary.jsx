import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null, errorInfo: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('=== APP CRASH ===');
    console.error(error);
    console.error(errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '20px', background: '#0a0a0a', color: '#fff', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626' }}>App Crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#fff' }}>{this.state.error.toString()}</pre>
          {this.state.errorInfo && (
            <>
              <h3>Component Stack:</h3>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#888' }}>{this.state.errorInfo.componentStack}</pre>
            </>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
