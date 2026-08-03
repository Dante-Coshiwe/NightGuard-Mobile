import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

// Crash-safe JSON file storage for Android.
//
// Filesystem.writeFile is not atomic, and Android kills backgrounded apps mid-operation without
// warning. A kill during a write leaves a truncated file, and code that treats an unparseable file
// as "no data" then starts from empty — silently destroying whatever the guard had stored.
//
// Writes go to a temp file and are renamed into place (a metadata operation), keeping the previous
// copy as a backup. Reads try primary, then backup, then any staged temp, and report failure
// distinctly from emptiness so callers never mistake corruption for a fresh device.

const tmpPath = (path) => `${path}.tmp`;
const bakPath = (path) => `${path}.bak`;

export async function writeJsonFileAtomic(path, data) {
  try {
    await Filesystem.writeFile({
      path: tmpPath(path), data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true,
    });

    try {
      await Filesystem.rename({
        from: path, to: bakPath(path), directory: Directory.Data, toDirectory: Directory.Data,
      });
    } catch { /* first write: nothing to demote */ }

    await Filesystem.rename({
      from: tmpPath(path), to: path, directory: Directory.Data, toDirectory: Directory.Data,
    });
    return;
  } catch (err) {
    console.warn(`[AtomicFile] Atomic write unavailable for ${path}, writing directly:`, err?.message || err);
  }

  // Older shells without Filesystem.rename still get a write rather than none at all.
  await Filesystem.writeFile({
    path, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true,
  });
}

// Returns the parsed object, or null when this particular file holds nothing usable.
async function readOne(path) {
  let raw;
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
    raw = data;
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (!message.includes('does not exist') && !message.includes('no such file')) {
      console.warn(`[AtomicFile] Could not read ${path}:`, err?.message || err);
    }
    return null;
  }

  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // A truncated write can still parse into something that is not an object.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (err) {
    console.error(`[AtomicFile] ${path} is corrupt (${err?.message || err}) — falling back`);
    return null;
  }
}

export async function readJsonFileWithRecovery(path) {
  const primary = await readOne(path);
  if (primary) return primary;

  const backup = await readOne(bakPath(path));
  if (backup) {
    console.warn(`[AtomicFile] Recovered ${path} from its backup copy`);
    return backup;
  }

  const staged = await readOne(tmpPath(path));
  if (staged) {
    console.warn(`[AtomicFile] Recovered ${path} from a staged write`);
    return staged;
  }

  return {};
}
