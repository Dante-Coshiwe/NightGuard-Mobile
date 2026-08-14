// ============================================================================
//  Which handset filed this?
//
//  A site normally runs one device, and that device's own entries never need a
//  server read at all — they go into state and the cache the moment the guard
//  saves, online or off. So the list a guard is looking at is this handset's own
//  work, and it is live by construction. Nothing has to be fetched for it.
//
//  Two devices writing to one site is the case worth catching, because then the
//  list stops being "what I did" and the guard has no way to tell whose entry is
//  whose. summariseDevices() answers both questions in one pass: which rows are
//  mine, and is anybody else dumping data here.
//
//  TWO TRAPS, both of them live in the current data (checked 2026-08-14):
//
//  1. `device_id` on ob_entries/incidents is the `devices` table ROW id (a uuid)
//     — NOT the hardware `NG-<ANDROID_ID>`. See currentDeviceRowId() in
//     services/api.js. Match on `getCurrentDeviceRecord()?.id`, never on
//     getDeviceId().
//
//  2. It is **null** on everything written before ensureDeviceRecord() began
//     self-registering handsets: 14 of the 17 OB entries on record. Those rows
//     are history, not a second device. Counting them as one would make a
//     single-handset site report two devices, and filtering them out would wipe
//     most of the occurrence book off the guard's screen — which is why the
//     filter below only ever engages when a second device has genuinely written.
// ============================================================================

/**
 * @param rows        the entries as rendered (server rows and offline ones alike)
 * @param deviceRowId this handset's `devices.id`, from getCurrentDeviceRecord()
 * @param devices     the site's device roster, for naming (cached site settings)
 * @param timestampKey which column carries the time — captured_timestamp / reported_at
 */
export function summariseDevices(rows, { deviceRowId = null, devices = [], timestampKey } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const roster = Array.isArray(devices) ? devices : [];
  const myKey = deviceRowId ? String(deviceRowId) : null;

  const byDevice = new Map();
  const unattributed = [];

  for (const row of list) {
    const key = row?.device_id ? String(row.device_id) : null;
    if (!key) {
      unattributed.push(row);
      continue;
    }
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(row);
  }

  // Distinct handsets that have actually written here. The null bucket is deliberately not
  // counted — see trap 2 above.
  const writingDeviceCount = byDevice.size;
  const multiDevice = writingDeviceCount > 1;

  // Hide nothing unless there is genuinely something to disambiguate. With one writing handset
  // (or none registered yet) every row on this site came from here, and filtering would only
  // delete the guard's own history off the screen. Same when this handset does not yet know
  // which device record is its own: never hide what you cannot attribute.
  const mine = (multiDevice && myKey) ? (byDevice.get(myKey) || []) : list;

  const nameFor = (key) => {
    const record = roster.find((device) => String(device?.id) === key);
    return record?.device_name || record?.device_id || `Device ${key.slice(0, 8)}`;
  };

  const latestOf = (items) => items.reduce((newest, row) => {
    const time = new Date(row?.[timestampKey] || 0).getTime();
    return Number.isFinite(time) && time > newest ? time : newest;
  }, 0);

  const breakdown = [...byDevice.entries()]
    .map(([key, items]) => ({
      key,
      name: nameFor(key),
      isThisDevice: key === myKey,
      count: items.length,
      lastAt: latestOf(items) || null,
    }))
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));

  if (unattributed.length) {
    breakdown.push({
      key: 'unattributed',
      name: 'Not attributed to a device',
      note: 'Recorded before handsets registered themselves',
      isThisDevice: false,
      count: unattributed.length,
      lastAt: latestOf(unattributed) || null,
    });
  }

  return {
    mine,
    multiDevice,
    writingDeviceCount,
    unattributedCount: unattributed.length,
    breakdown,
    hiddenFromMine: multiDevice && myKey ? list.length - mine.length : 0,
  };
}

export default summariseDevices;
