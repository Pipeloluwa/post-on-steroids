import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const helpModalPath = path.join(
  rootDir,
  'src',
  'app',
  'shared',
  'components',
  'help-updates.modal.component',
  'help-updates.modal.component.ts'
);

const aboutModalPath = path.join(
  rootDir,
  'src',
  'app',
  'shared',
  'components',
  'about.modal.component',
  'about.modal.component.ts'
);

function parseSemver(ver) {
  return String(ver || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/-.*$/, '')
    .split('.')
    .map((n) => Number(n) || 0);
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Synchronize version between package.json and help-updates.modal.component.ts
let version = pkg.version || '1.0.0';
let suffix = '-steroids';
if (fs.existsSync(helpModalPath)) {
  try {
    const modalContent = fs.readFileSync(helpModalPath, 'utf8');
    const match = modalContent.match(/appVersion\s*=\s*['"]v?(\d+\.\d+\.\d+)([^'"]*)['"]/i);
    if (match && match[1]) {
      const modalSemver = match[1];
      suffix = match[2] || '-steroids';
      const cmp = compareSemver(modalSemver, version);
      if (cmp > 0) {
        // Modal version was bumped -> sync into package.json
        version = modalSemver;
        pkg.version = version;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      } else if (cmp < 0) {
        // package.json version was bumped -> sync into help-updates.modal.component.ts
        const updatedModal = modalContent.replace(
          /appVersion\s*=\s*['"][^'"]+['"]/,
          `appVersion = 'v${version}${suffix}'`
        );
        fs.writeFileSync(helpModalPath, updatedModal, 'utf8');
      }
    }
  } catch {
    // Ignore sync errors
  }
}

// Also keep about.modal.component.ts synchronized with the active appVersion
if (fs.existsSync(aboutModalPath)) {
  try {
    const aboutContent = fs.readFileSync(aboutModalPath, 'utf8');
    const updatedAbout = aboutContent.replace(
      /appVersion\s*=\s*['"][^'"]+['"]/,
      `appVersion = 'v${version}${suffix}'`
    );
    if (updatedAbout !== aboutContent) {
      fs.writeFileSync(aboutModalPath, updatedAbout, 'utf8');
    }
  } catch {
    // Ignore sync errors
  }
}

function extractUpdateBaseUrl(envFilePath, fallbackUrl) {
  try {
    if (fs.existsSync(envFilePath)) {
      const content = fs.readFileSync(envFilePath, 'utf8');
      const match = content.match(/updateBaseUrl\s*:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        return match[1].trim().replace(/\/+$/, '');
      }
    }
  } catch {
    // Ignore read errors and use fallback
  }
  return fallbackUrl;
}

const envDir = path.join(rootDir, 'src', 'environments');
const prodUpdateBaseUrl = extractUpdateBaseUrl(
  path.join(envDir, 'environment.prod.ts'),
  'https://onsteroid.com/download'
);
const devUpdateBaseUrl = extractUpdateBaseUrl(
  path.join(envDir, 'environment.ts'),
  'http://localhost:5000/download'
);

const now = new Date();
const buildTime = now.getTime();
const buildDate = now.toISOString();

const versionData = {
  version,
  buildTime,
  buildDate,
  updateBaseUrl: prodUpdateBaseUrl,
  devUpdateBaseUrl
};

// 1. Write public/version.json for runtime HTTP fetches & packaged Electron lookup
const publicDir = path.join(rootDir, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
const versionJsonPath = path.join(publicDir, 'version.json');
fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

// Also keep dist/post-on-steroids/browser/version.json synchronized if dist/ already exists
const distBrowserDir = path.join(rootDir, 'dist', 'post-on-steroids', 'browser');
if (fs.existsSync(distBrowserDir)) {
  try {
    fs.writeFileSync(
      path.join(distBrowserDir, 'version.json'),
      JSON.stringify(versionData, null, 2) + '\n',
      'utf8'
    );
  } catch {
    // Ignore if dist directory is locked or read-only
  }
}

// 2. Write src/environments/version.ts for compiled bundle reference
if (!fs.existsSync(envDir)) {
  fs.mkdirSync(envDir, { recursive: true });
}
const versionTsPath = path.join(envDir, 'version.ts');
const versionTsContent = `// Auto-generated during build. Do not edit manually.
export const APP_VERSION_INFO = {
  version: '${version}',
  buildTime: ${buildTime},
  buildDate: '${buildDate}'
} as const;
`;
fs.writeFileSync(versionTsPath, versionTsContent, 'utf8');

// 3. Keep electron-builder.json publish URL synchronized with environment.prod.ts updateBaseUrl
const electronBuilderPath = path.join(rootDir, 'electron-builder.json');
if (fs.existsSync(electronBuilderPath)) {
  try {
    const ebConfig = JSON.parse(fs.readFileSync(electronBuilderPath, 'utf8'));
    const normalizedPublishUrl = `${prodUpdateBaseUrl.replace(/\/+$/, '')}/`;
    if (
      Array.isArray(ebConfig.publish) &&
      ebConfig.publish[0] &&
      ebConfig.publish[0].url !== normalizedPublishUrl
    ) {
      ebConfig.publish[0].url = normalizedPublishUrl;
      fs.writeFileSync(electronBuilderPath, JSON.stringify(ebConfig, null, 2) + '\n', 'utf8');
    }
  } catch {
    // Ignore if electron-builder.json cannot be updated
  }
}

console.log(`[generate-version] Generated version ${version} (buildTime: ${buildTime})`);
