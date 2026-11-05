import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version || '1.0.0';
const releaseDate = new Date().toISOString();

if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

function getFileEntry(filename) {
  const filePath = path.join(releaseDir, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  const sha512 = crypto.createHash('sha512').update(buffer).digest('base64');
  const size = buffer.byteLength;
  return { url: filename, sha512, size };
}

function formatYaml(primaryEntry, entries) {
  const filesBlock = entries
    .map(
      (e) =>
        `  - url: ${e.url}\n    sha512: ${e.sha512}\n    size: ${e.size}`
    )
    .join('\n');

  return [
    `version: ${version}`,
    `files:`,
    filesBlock,
    `path: ${primaryEntry.url}`,
    `sha512: ${primaryEntry.sha512}`,
    `releaseDate: '${releaseDate}'`,
    ''
  ].join('\n');
}

// 1. Windows manifest (latest.yml)
const winExe = getFileEntry('OnSteroid-Setup.exe');
const winZip = getFileEntry('OnSteroid-win-x64.zip');
const winEntries = [winExe, winZip].filter(Boolean);
if (winEntries.length > 0) {
  const primaryWin = winExe || winZip;
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), formatYaml(primaryWin, winEntries), 'utf8');
  console.log(`Updated release/latest.yml (${winEntries.map((e) => e.url).join(', ')})`);
}

// 2. Linux manifest (latest-linux.yml)
const linuxTarGz = getFileEntry('OnSteroid-linux-x64.tar.gz');
const linuxZip = getFileEntry('OnSteroid-linux-x64.zip');
const linuxEntries = [linuxTarGz, linuxZip].filter(Boolean);
if (linuxEntries.length > 0) {
  const primaryLinux = linuxTarGz || linuxZip;
  fs.writeFileSync(
    path.join(releaseDir, 'latest-linux.yml'),
    formatYaml(primaryLinux, linuxEntries),
    'utf8'
  );
  console.log(`Generated release/latest-linux.yml (${linuxEntries.map((e) => e.url).join(', ')})`);
}

// 3. macOS manifest (latest-mac.yml) if macOS artifacts exist in release/
const macDmg = getFileEntry('OnSteroid.dmg');
const macZip = getFileEntry('OnSteroid.zip');
const macEntries = [macZip, macDmg].filter(Boolean);
if (macEntries.length > 0) {
  const primaryMac = macZip || macDmg;
  fs.writeFileSync(
    path.join(releaseDir, 'latest-mac.yml'),
    formatYaml(primaryMac, macEntries),
    'utf8'
  );
  console.log(`Generated release/latest-mac.yml (${macEntries.map((e) => e.url).join(', ')})`);
}

// 4. Generate release/web.config so IIS serves .yml, .yaml, and .blockmap files in /download without 404.3 errors
const downloadWebConfig = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <remove fileExtension=".yml" />
      <mimeMap fileExtension=".yml" mimeType="text/yaml" />
      <remove fileExtension=".yaml" />
      <mimeMap fileExtension=".yaml" mimeType="text/yaml" />
      <remove fileExtension=".blockmap" />
      <mimeMap fileExtension=".blockmap" mimeType="application/octet-stream" />
      <remove fileExtension=".exe" />
      <mimeMap fileExtension=".exe" mimeType="application/octet-stream" />
      <remove fileExtension=".zip" />
      <mimeMap fileExtension=".zip" mimeType="application/zip" />
      <remove fileExtension=".tar.gz" />
      <mimeMap fileExtension=".tar.gz" mimeType="application/gzip" />
      <remove fileExtension=".gz" />
      <mimeMap fileExtension=".gz" mimeType="application/gzip" />
      <remove fileExtension=".deb" />
      <mimeMap fileExtension=".deb" mimeType="application/vnd.debian.binary-package" />
      <remove fileExtension=".dmg" />
      <mimeMap fileExtension=".dmg" mimeType="application/x-apple-diskimage" />
      <remove fileExtension=".AppImage" />
      <mimeMap fileExtension=".AppImage" mimeType="application/octet-stream" />
    </staticContent>
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="524288000" />
      </requestFiltering>
    </security>
  </system.webServer>
</configuration>
`;
fs.writeFileSync(path.join(releaseDir, 'web.config'), downloadWebConfig, 'utf8');
console.log('Generated release/web.config (IIS MIME mappings for .yml, .blockmap, and installers)');
