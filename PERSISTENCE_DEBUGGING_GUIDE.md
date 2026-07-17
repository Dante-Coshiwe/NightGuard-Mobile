# NightGuard Persistence & Offline Debugging Guide

## Overview
The app has comprehensive logging enabled to track all offline data persistence and synchronization. All operations are logged to the browser console.

---

## How to View Logs

1. **Open Browser DevTools**: Press `F12` or right-click → Inspect
2. **Go to Console tab**: See all `[DeviceStore]`, `[OfflineApi]`, `[OfflineQueue]` logs
3. **Filter logs**: Type in search box to find specific operations

---

## Understanding the Log Prefixes

### `[DeviceStore]` - Local Data Persistence
- `[DeviceStore] READ "{key}"` - Reading data from localStorage
- `[DeviceStore] WRITE "{key}"` - Saving data to localStorage
- `[DeviceStore] saveCachedPedestrians()` - Pedestrian data persisted
- `[DeviceStore] saveCachedVehicles()` - Vehicle data persisted
- `[DeviceStore] updateCachedPedestrian()` - Pedestrian record updated

### `[OfflineApi]` - API Request Handling (Online/Offline)
- `POST/PATCH/PUT {url} - ATTEMPTING ONLINE` - Trying to send online
- `POST/PATCH/PUT {url} - QUEUED` - Saved for later sync
- `POST/PATCH/PUT {url} - SUCCESS` - Successfully sent to server
- `POST/PATCH/PUT {url} - FALLBACK TO QUEUE` - Network error, queued instead

### `[OfflineQueue]` - Sync Manager
- `[OfflineQueue] getQueue(): {n} items pending` - Offline queue status
- `[OfflineQueue] enqueueOfflineItem(): QUEUED - {method} {url}` - Item added to queue
- `[OfflineQueue] SYNC STARTED - {n} items to sync` - Sync process beginning
- `[OfflineQueue] SYNC ITEM - {method} {url}` - Processing individual queued item
- `[OfflineQueue] SYNC SUCCESS` - Item successfully synced
- `[OfflineQueue] SYNC ERROR` - Item failed to sync
- `[OfflineQueue] SYNC COMPLETED` - Sync process finished

---

## Monitoring Workflow

### When Adding Data Offline

1. **Register a pedestrian OFFLINE** (no internet)
   ```
   [RegisterPedestrianScreen] Registering pedestrian offline: John Doe, tempId=reg_ped_1234567890
   [OfflineApi] POST /pedestrians/entry - QUEUED (offline/noSession/forced)
   [DeviceStore] upsertCachedPedestrian(): adding/updating id="reg_ped_1234567890", name="John Doe"
   [DeviceStore] WRITE "cached_pedestrians": count=1, size=XXXbytes
   [DeviceStore] saveCachedPedestrians(): saved 1 entries
   Success: Person saved offline on this device (will sync online)
   ```

2. **Check Queue Status**
   ```
   [OfflineQueue] getQueue(): 1 items pending
   ```

3. **View Cached Data** (in DevTools Console)
   ```javascript
   // View all cached pedestrians
   JSON.parse(localStorage.getItem('cached_pedestrians'))
   
   // View offline queue
   JSON.parse(localStorage.getItem('nightguard_offline_queue'))
   ```

### When Coming Back Online

1. **Automatic Sync Triggers**
   ```
   [OfflineQueue] SYNC STARTED - 1 items to sync at 2025-04-23T10:30:00.000Z
   [OfflineQueue] SYNC ITEM - POST /pedestrians/entry
   [OfflineApi] POST /pedestrians/entry - ATTEMPTING ONLINE
   [OfflineApi] POST /pedestrians/entry - SUCCESS
   [OfflineQueue] SYNC SUCCESS - POST /pedestrians/entry, responseId=uuid-12345
   [OfflineQueue] SYNC - Mapped tempId "reg_ped_1234567890" -> "uuid-12345"
   [OfflineQueue] replaceCachedEntity(): Updating cached_pedestrians cache with serverId=uuid-12345
   [DeviceStore] UPDATE "cached_pedestrians": count=1
   [OfflineQueue] SYNC COMPLETED - final status: FULL
   ```

2. **Queue Cleared**
   ```
   [OfflineQueue] getQueue(): 0 items pending
   ```

---

## Report Data Source Indicator

The report screens now display where the data is coming from:

- **🟢 SERVER** (Green background) - Fresh data from server
- **🟡 OFFLINE CACHE** (Orange background) - Local cached data shown

### Reports Show:
- **PedestrianReport** - `[PedestrianReport] Loaded X records from SERVER/OFFLINE CACHE`
- **VehicleReport** - `[VehicleReport] Loaded X records from SERVER/OFFLINE CACHE`

---

## Troubleshooting

### Data Not Persisting

**Problem**: Data disappears after app restarts

1. Check console for `[DeviceStore] WRITE` errors
2. Verify localStorage has space: 
   ```javascript
   // In DevTools Console
   localStorage.length  // Should show stored items
   Object.keys(localStorage).filter(k => k.includes('nightguard'))
   ```
3. Check browser storage settings (not in private/incognito mode)

### Offline Queue Not Syncing

1. Check queue contents:
   ```javascript
   JSON.parse(localStorage.getItem('nightguard_offline_queue'))
   ```

2. Look for sync errors in console (search for `[OfflineQueue] SYNC ERROR`)

3. Check if app is truly online:
   ```javascript
   navigator.onLine  // Should be true
   ```

4. Verify authenticated session:
   ```javascript
   // Will be shown in logs
   [OfflineQueue] SYNC STARTED - indicates session is valid
   ```

### Reports Not Updating

1. Check data source indicator at top of report
2. If showing "OFFLINE CACHE", data will update when coming online
3. Force refresh data in console:
   ```javascript
   // Manually trigger report reload
   window.location.reload()
   ```

---

## Checking Data Integrity

### Validate Offline Queue Items

```javascript
// View queue with formatting
const queue = JSON.parse(localStorage.getItem('nightguard_offline_queue') || '[]');
console.table(queue);
```

### Validate Cached Data

```javascript
// Cached pedestrians
const peds = JSON.parse(localStorage.getItem('cached_pedestrians') || '[]');
console.table(peds.map(p => ({ id: p.id, name: p.name, _offline: p._offline })));

// Cached vehicles  
const vehicles = JSON.parse(localStorage.getItem('cached_vehicles') || '[]');
console.table(vehicles.map(v => ({ id: v.id, plate: v.licensePlate, _offline: v._offline })));
```

### Check Sync Logs

```javascript
// View recent sync history
const logs = JSON.parse(localStorage.getItem('nightguard_sync_logs') || '[]');
console.table(logs.slice(0, 10));
```

---

## Performance Monitoring

### Storage Usage

```javascript
// Check total storage used
let total = 0;
for (let key in localStorage) {
  if (key.includes('nightguard')) {
    total += localStorage[key].length;
  }
}
console.log(`Total NightGuard storage: ${(total / 1024).toFixed(2)} KB`);
```

### Queue Processing Time

Look for time difference between:
- `[OfflineQueue] SYNC STARTED` 
- `[OfflineQueue] SYNC COMPLETED`

---

## Common Scenarios

### Scenario 1: Add Data Offline, Go Online
1. Disable network (DevTools Network tab)
2. Add pedestrian "Test User"
3. Check console for `QUEUED` message
4. Enable network
5. Look for `SYNC STARTED` → `SYNC COMPLETED` messages
6. Data should now have server ID instead of temp ID

### Scenario 2: View Report Offline vs Online
1. Open Reports → Vehicle Report while ONLINE → should show 🟢 SERVER
2. Disable network
3. Refresh report → should show 🟡 OFFLINE CACHE
4. Enable network
5. Refresh report → should show 🟢 SERVER again with fresh data

### Scenario 3: Sync Failure Recovery
1. Add data while offline
2. Enable network but simulate API error
3. Check queue - items should remain
4. Fix API issue
5. Sync should retry on next online event

---

## Key Files to Monitor

- **deviceStore.js** - All local storage operations logged
- **useOfflineApi.js** - Online/offline request handling logged
- **useOfflineQueue.js** - Sync mechanism logged in detail
- **Report screens** - Data source indicator shown with logging

---

## Support Info

When reporting issues, include:
1. **Console logs** (F12 → Console tab)
2. **localStorage contents** (see validation section above)
3. **Network status** (F12 → Network tab or `navigator.onLine`)
4. **Steps to reproduce** the issue

All operations are fully logged. Check console first for diagnosis.
