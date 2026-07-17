// Generates the source images @capacitor/assets needs, branded with the NightGuard logo.
//   - Launcher icon: the full NightGuard mark (public/logo.webp) on white.
//   - Splash: the NIGHTGUARD wordmark on dark #06070a, matching the in-app splash.
// Run: node scripts/make-brand-assets.mjs   then   npx @capacitor/assets generate --android
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });

const DARK = '#06070a';

// Extract the transparent wordmark PNG (light text, for dark backgrounds) from the JS module.
const logoJs = fs.readFileSync(path.join(root, 'src/lib/nightguardLogo.js'), 'utf8');
const wordmark = Buffer.from(logoJs.match(/base64,([A-Za-z0-9+/=]+)/)[1], 'base64');

async function iconOnWhite(logoWidth, outName) {
  const logo = await sharp(path.join(root, 'public/logo.webp')).resize({ width: logoWidth }).png().toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(assets, outName));
}

async function splash(outName) {
  const wm = await sharp(wordmark).resize({ width: 980 }).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: DARK } })
    .composite([{ input: wm, gravity: 'center' }])
    .png()
    .toFile(path.join(assets, outName));
}

await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' } })
  .png()
  .toFile(path.join(assets, 'icon-background.png'));
await iconOnWhite(600, 'icon-foreground.png'); // adaptive foreground (kept inside the safe zone)
await iconOnWhite(760, 'icon-only.png');       // legacy square/round icon
await splash('splash.png');
await splash('splash-dark.png');

console.log('Brand source assets written to', assets);
