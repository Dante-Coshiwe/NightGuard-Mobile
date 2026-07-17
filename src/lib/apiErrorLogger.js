/**
 * Comprehensive API error logging utility
 * Logs all API failures with context for offline debugging
 */

function getNetworkContext() {
  return {
    isOnline: navigator.onLine,
    timestamp: new Date().toISOString(),
  };
}

function logApiError(context, error, operation = '') {
  const ctx = getNetworkContext();
  const errorMsg = error?.message || String(error);
  const status = error?.response?.status || error?.status || 'unknown';
  const prefix = operation ? `[${operation}]` : '[API]';

  if (!navigator.onLine) {
    console.error(
      `${prefix} OFFLINE FAILURE - ${operation || 'API call failed'}\n` +
      `  Error: ${errorMsg}\n` +
      `  Status: ${status}\n` +
      `  When: ${ctx.timestamp}`,
      error
    );
  } else {
    console.error(
      `${prefix} ONLINE FAILURE - Network/Server error\n` +
      `  Error: ${errorMsg}\n` +
      `  Status: ${status}\n` +
      `  When: ${ctx.timestamp}`,
      error
    );
  }

  return {
    errorMsg,
    status,
    isOffline: !navigator.onLine,
    timestamp: ctx.timestamp,
  };
}

function logApiAttempt(operation, method, url) {
  const ctx = getNetworkContext();
  console.log(
    `[${operation}] Attempting ${method} ${url} ` +
    `(${ctx.isOnline ? 'ONLINE' : 'OFFLINE'})`
  );
}

function logApiSuccess(operation, method, url, dataSize = 0) {
  console.log(
    `[${operation}] SUCCESS - ${method} ${url} ` +
    `(${dataSize} items)`
  );
}

function logOfflineUsage(operation, source = 'cache') {
  console.log(
    `[${operation}] Using ${source} (offline fallback)`
  );
}

export {
  logApiError,
  logApiAttempt,
  logApiSuccess,
  logOfflineUsage,
  getNetworkContext,
};
