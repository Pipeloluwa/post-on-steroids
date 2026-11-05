import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

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
const version = pkg.version || '1.0.0';

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
