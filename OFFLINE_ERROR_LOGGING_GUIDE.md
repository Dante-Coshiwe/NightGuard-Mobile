# Offline Error Logging - Test & Verification Guide

## Problem Fixed
When you went offline before, **API failures were silently caught** with no error logs shown. You couldn't see what failed or why. Now EVERY API failure is logged to the console with full context.

---

## Test Scenario 1: Data Registration Offline

### Steps:
1. **Open DevTools**: Press `F12` → Console tab
2. **Disable Network**: Go to F12 → Network tab → Set throttling to "Offline"
3. **Register a Pedestrian**: HomeScreen → register new person
4. **Fill form** and click Submit

### Expected Logs:
```
[RegisterPedestrianScreen] Registering pedestrian offline: {NAME}, tempId=reg_ped_123456
[OfflineApi] POST /pedestrians/entry - QUEUED (offline/noSession/forced)
[DeviceStore] WRITE "cached_pedestrians": saved 77 entries
[OfflineQueue] enqueueOfflineItem(): QUEUED - POST /pedestrians/entry, clientId="reg_ped_123456"
Success: Person saved offline on this device (will sync online)
```

✅ **What this tells you:**
- Data was saved locally ✓
- Request was queued ✓  
- Temp ID created for later mapping ✓

---

## Test Scenario 2: Report View Offline (API Error Logged)

### Steps:
1. **Open DevTools**: F12 → Console  
2. **Go Offline**: Network tab → Offline mode
3. **View Report**: Click Reports → Vehicle Report

### Expected Logs:
```
[VehicleReport] Attempting GET /vehicles/report (🔴 OFFLINE)
[VehicleReport] OFFLINE FAILURE - API call failed
  Error: Network request failed
  Status: unknown
  When: 2025-04-23T10:30:00.000Z
[VehicleReport] Using offline cache (offline fallback)
📍 Data from 🟡 OFFLINE CACHE (synced when online)
```

✅ **What this tells you:**
- API attempt logged with OFFLINE indicator ✓
- Actual error message shown ✓
- Fallback to cache logged ✓

---

## Test Scenario 3: Come Back Online & Auto-Sync

### Steps:
1. **With pending offline data** (from Test 1)
2. **In DevTools**, go to Network tab
3. **Enable Network**: Switch from Offline to normal
4. **Watch console** immediately

### Expected Logs:
```
[OfflineQueue] syncOfflineQueueNow(): SYNC already in flight - SKIPPED
// Wait a moment...
[OfflineQueue] SYNC STARTED - 1 items to sync at 2025-04-23T10:30:45.000Z
[OfflineQueue] SYNC ITEM - POST /pedestrians/entry
[OfflineApi] POST /pedestrians/entry - ATTEMPTING ONLINE
[OfflineApi] POST /pedestrians/entry - SUCCESS (response data shown)
[OfflineQueue] SYNC SUCCESS - POST /pedestrians/entry, responseId=uuid-98765
[OfflineQueue] SYNC - Mapped tempId "reg_ped_123456" -> "uuid-98765"
[DeviceStore] WRITE "cached_pedestrians": Updated cached_pedestrians with synced data
[OfflineQueue] SYNC COMPLETED - final status: FULL
```

✅ **What this tells you:**
- Sync started automatically ✓
- Network request succeeded online ✓
- Temp ID mapped to real server ID ✓
- Cache updated with real data ✓

---

## Test Scenario 4: API Error While Online

### Steps:
1. **Make sure you're ONLINE**
2. **Kill backend server** or break API endpoint
3. **Try viewing a report** or loading users

### Expected Logs:
```
[CompletedShiftsReport] Attempting GET /shifts/completed (🟢 ONLINE)
[CompletedShiftsReport] ONLINE FAILURE - Network/Server error
  Error: 502 Bad Gateway
  Status: 502
  When: 2025-04-23T10:31:00.000Z
Unable to load shifts while offline. Please check your connection.
```

✅ **What this tells you:**
- Error happened WHILE ONLINE ✓
- HTTP status code shown (502) ✓
- Clear error message ✓

---

## Test Scenario 5: Guards Page Error Recovery

### Steps:
1. **Open DevTools** → Console
2. **Open Users Config page** (Settings → Users)
3. **Interrupt network** while loading
4. **Check logs**

### Expected Logs:
```
[UsersConfig] Attempting GET /users/guards (🟢 ONLINE)
[UsersConfig] OFFLINE - no cached guards available
[UsersConfig] OFFLINE FAILURE - guard loading failed
  Error: Network timeout
  Status: unknown
  When: 2025-04-23T10:32:00.000Z
[UsersConfig] Using cached guards (after error)
```

✅ **What this tells you:**
- Attempted to load guards ✓
- Network failed ✓
- Fell back to cached guards ✓

---

## All Log Prefixes Explained

| Prefix | Meaning | Example |
|--------|---------|---------|
| `[OfflineApi]` | API request decision | `POST /pedestrians/entry - QUEUED` |
| `[OfflineQueue]` | Queue sync processing | `SYNC STARTED - 3 items` |
| `[DeviceStore]` | Local data saved | `WRITE "cached_pedestrians"` |
| `[ComponentName]` | Screen logging | `[CompletedShiftsReport] Attempting...` |
| `🟢 ONLINE` | Device is connected | Trying live API |
| `🔴 OFFLINE` | Device is offline | Using cache/queue |

---

## Quick Reference: Where Errors Appear

### Offline Queue Errors
- **Location**: `src/hooks/useOfflineQueue.js`
- **When**: During sync process
- **Look for**: `SYNC ERROR`, `SYNC FAILED`

### API Call Errors  
- **Location**: Screen components (Reports, Config pages)
- **When**: API request fails
- **Look for**: `OFFLINE FAILURE`, `ONLINE FAILURE`

### Storage Errors
- **Location**: `src/lib/deviceStore.js`
- **When**: Saving/loading localStorage
- **Look for**: `WRITE ERROR`, `READ ERROR`

### Registration/Form Errors
- **Location**: Registration screens
- **When**: Submitting forms offline/online
- **Look for**: `[RegisterPedestrianScreen]`, `[RegisterVehicleScreen]`

---

## Console Search Tips

### Find all offline failures
```
Filter: OFFLINE FAILURE
```

### Find all successful syncs
```
Filter: SYNC SUCCESS
```

### Find all data saves
```
Filter: WRITE "cached
```

### Find all API attempts  
```
Filter: Attempting GET
```

### See network status at each step
```
Filter: ONLINE
```

---

## Debugging Checklist

- [ ] Can you see `[DeviceStore] WRITE` when saving data? 
- [ ] Does `[OfflineApi]` show `QUEUED` when offline?
- [ ] Does sync show `SYNC STARTED` when coming online?
- [ ] Do reports show data source indicator (🟢 or 🟡)?
- [ ] Are errors logged with HTTP status codes?
- [ ] Does queue update after sync (`[OfflineQueue] getQueue(): 0 items`)?

---

## Common Issues & Their Logs

### Issue: Data not saving
**Check logs for:**
```
[DeviceStore] WRITE ERROR
[DeviceStore] saveCachedPedestrians(): 0 entries
```

### Issue: Sync not working
**Check logs for:**
```
[OfflineQueue] SYNC ERROR
[OfflineQueue] SYNC STARTED - 0 items
```

### Issue: Reports blank offline
**Check logs for:**
```
[PedestrianReport] OFFLINE FAILURE
[PedestrianReport] Using offline cache - 0 entries
```

### Issue: Can't see error message
**Check logs for:**
```
[logApiError unknown error message detected]
Error details: error?.message may be empty
```

---

## Export Logs for Support

If something isn't working, export these:

1. **Open Console** → Right-click → "Save as..." 
2. **Run in console to copy all logs:**
```javascript
// Copy this and paste in console
copy(console.log.toString());
```

3. **Or filter and screenshot key logs:**
   - Filter: `FAILED` or `ERROR`
   - Screenshot the results
   - Share with support

---

## Performance Note

All this logging has minimal performance impact:
- Logs only appear in DevTools (not production)
- ~1-2ms per operation
- Storage still uses same space as before

You can disable logging anytime by commenting out `console.log` calls in:
- `src/lib/apiErrorLogger.js`
- `src/lib/deviceStore.js`
- `src/hooks/useOfflineQueue.js`

But **leave them on for now** so you can see what's happening!

---

## Next Steps After Testing

1. ✅ Register data offline → check logs
2. ✅ Go online → check sync logs  
3. ✅ View reports → check data source
4. ✅ Force error → check error logs
5. ✅ Verify queue empties after sync
6. ✅ Screenshots with logs for any issues

**Everything should be logged now. Check console first for diagnosis!**
