import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');

function readExistingYamlMeta(yamlPath) {
  if (!fs.existsSync(yamlPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(yamlPath, 'utf8');
    const verMatch = raw.match(/^version:\s*['"]?([^\s'"]+)['"]?/m);
    const shaMatch = raw.match(/^sha512:\s*['"]?([^\s'"]+)['"]?/m);
    const dateMatch = raw.match(/^releaseDate:\s*['"]?([^\r\n'"]+)['"]?/m);
    return {
      version: verMatch ? verMatch[1].trim() : null,
      sha512: shaMatch ? shaMatch[1].trim() : null,
      releaseDate: dateMatch ? dateMatch[1].trim() : null
    };
  } catch {
    return null;
  }
}

function readExistingJsonPlatformMeta(jsonPath, platformKey) {
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const entry = data && data.platforms && data.platforms[platformKey];
    if (!entry) return null;
    return {
      version: data.version || null,
      sha512: entry.sha512 || null,
      releaseDate: entry.releaseDate || data.releaseDate || null
    };
  } catch {
    return null;
  }
}

export default function generateUpdateManifests() {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  // Prefer dist/post-on-steroids/browser/version.json (exact file packaged inside app.asar), fallback to public/version.json
  const distVersionJsonPath = path.join(rootDir, 'dist', 'post-on-steroids', 'browser', 'version.json');
  const publicVersionJsonPath = path.join(rootDir, 'public', 'version.json');

  let versionMeta = null;
  for (const candidate of [distVersionJsonPath, publicVersionJsonPath]) {
    if (fs.existsSync(candidate)) {
      try {
        versionMeta = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        break;
      } catch {
        versionMeta = null;
      }
    }
  }

  const version = (versionMeta && versionMeta.version) || pkg.version || '1.0.0';
  const defaultReleaseDate = (versionMeta && versionMeta.buildDate) || new Date().toISOString();
  const defaultBuildTime = (versionMeta && versionMeta.buildTime) || Date.parse(defaultReleaseDate);

  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  const latestJsonPath = path.join(releaseDir, 'latest.json');

  function getFileEntry(filename) {
    const filePath = path.join(releaseDir, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stat = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);
    const sha512 = crypto.createHash('sha512').update(buffer).digest('base64');
    const size = buffer.byteLength;
    return { url: filename, sha512, size, mtimeMs: stat.mtimeMs };
  }

  function resolvePlatformReleaseDate(primaryEntry, yamlPath, platformKey) {
    if (!primaryEntry) {
      return { releaseDate: defaultReleaseDate, buildTime: defaultBuildTime };
    }
    // If the artifact on disk is older than the latest generate-version.mjs run,
    // preserve its previously recorded releaseDate if the SHA-512 & version match.
    if (primaryEntry.mtimeMs < defaultBuildTime) {
      const existingJson = readExistingJsonPlatformMeta(latestJsonPath, platformKey);
      const existingYaml = readExistingYamlMeta(yamlPath);
      const existing = (existingJson && existingJson.sha512 === primaryEntry.sha512)
        ? existingJson
        : existingYaml;
      if (
        existing &&
        existing.version === version &&
        existing.sha512 === primaryEntry.sha512 &&
        existing.releaseDate
      ) {
        const parsed = Date.parse(existing.releaseDate);
        if (!Number.isNaN(parsed)) {
          return { releaseDate: existing.releaseDate, buildTime: parsed };
        }
      }
    }
    return { releaseDate: defaultReleaseDate, buildTime: defaultBuildTime };
  }

  function formatYaml(primaryEntry, entries, platformMeta) {
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
      `releaseDate: '${platformMeta.releaseDate}'`,
      `buildTime: ${platformMeta.buildTime}`,
      ''
    ].join('\n');
  }

  // 1. Windows manifest (latest.yml)
  const winYamlPath = path.join(releaseDir, 'latest.yml');
  const winExe = getFileEntry('OnSteroid-Setup.exe');
  const winZip = getFileEntry('OnSteroid-win-x64.zip');
  const winEntries = [winExe, winZip].filter(Boolean);
  const primaryWinEntry = winExe || winZip;
  const winReleaseMeta = resolvePlatformReleaseDate(primaryWinEntry, winYamlPath, 'win32');
  if (winEntries.length > 0 && primaryWinEntry) {
    fs.writeFileSync(
      winYamlPath,
      formatYaml(primaryWinEntry, winEntries, winReleaseMeta),
      'utf8'
    );
    console.log(`Updated release/latest.yml (${winEntries.map((e) => e.url).join(', ')})`);
  }

  // 2. Linux manifest (latest-linux.yml)
  const linuxYamlPath = path.join(releaseDir, 'latest-linux.yml');
  const linuxTarGz = getFileEntry('OnSteroid-linux-x64.tar.gz');
  const linuxZip = getFileEntry('OnSteroid-linux-x64.zip');
  const linuxEntries = [linuxTarGz, linuxZip].filter(Boolean);
  const primaryLinuxEntry = linuxTarGz || linuxZip;
  const linuxReleaseMeta = resolvePlatformReleaseDate(primaryLinuxEntry, linuxYamlPath, 'linux');
  if (linuxEntries.length > 0 && primaryLinuxEntry) {
    fs.writeFileSync(
      linuxYamlPath,
      formatYaml(primaryLinuxEntry, linuxEntries, linuxReleaseMeta),
      'utf8'
    );
    console.log(`Generated release/latest-linux.yml (${linuxEntries.map((e) => e.url).join(', ')})`);
  }

  // 3. macOS manifest (latest-mac.yml) if macOS artifacts exist in release/
  const macYamlPath = path.join(releaseDir, 'latest-mac.yml');
  const macDmg = getFileEntry('OnSteroid.dmg');
  const macZip = getFileEntry('OnSteroid.zip');
  const macEntries = [macDmg, macZip].filter(Boolean);
  const primaryMacEntry = macDmg || macZip;
  const macReleaseMeta = resolvePlatformReleaseDate(primaryMacEntry, macYamlPath, 'darwin');
  if (macEntries.length > 0 && primaryMacEntry) {
    fs.writeFileSync(
      macYamlPath,
      formatYaml(primaryMacEntry, macEntries, macReleaseMeta),
      'utf8'
    );
    console.log(`Generated release/latest-mac.yml (${macEntries.map((e) => e.url).join(', ')})`);
  }

  // 4. Generate release/latest.json fallback (always served by IIS/web servers even if .yml MIME is missing)
  const latestJson = {
    version,
    buildTime: defaultBuildTime,
    releaseDate: defaultReleaseDate,
    platforms: {
      win32: primaryWinEntry
        ? {
            path: primaryWinEntry.url,
            sha512: primaryWinEntry.sha512,
            size: primaryWinEntry.size,
            buildTime: winReleaseMeta.buildTime,
            releaseDate: winReleaseMeta.releaseDate
          }
        : null,
      linux: primaryLinuxEntry
        ? {
            path: primaryLinuxEntry.url,
            sha512: primaryLinuxEntry.sha512,
            size: primaryLinuxEntry.size,
            buildTime: linuxReleaseMeta.buildTime,
            releaseDate: linuxReleaseMeta.releaseDate
          }
        : null,
      darwin: primaryMacEntry
        ? {
            path: primaryMacEntry.url,
            sha512: primaryMacEntry.sha512,
            size: primaryMacEntry.size,
            buildTime: macReleaseMeta.buildTime,
            releaseDate: macReleaseMeta.releaseDate
          }
        : null
    }
  };
  fs.writeFileSync(latestJsonPath, JSON.stringify(latestJson, null, 2) + '\n', 'utf8');
  console.log('Generated release/latest.json');

  // 5. Generate release/web.config so IIS serves .yml, .yaml, and .blockmap files in /download without 404.3 errors
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
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
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
  return [];
}

// Execute immediately when run directly via `node scripts/generate-update-manifests.mjs`
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  generateUpdateManifests();
}
