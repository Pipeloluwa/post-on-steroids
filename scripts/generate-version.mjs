import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const now = new Date();
const buildTime = now.getTime();
const buildDate = now.toISOString();
const version = pkg.version || '1.0.0';

const versionData = {
  version,
  buildTime,
  buildDate
};

// 1. Write public/version.json for runtime HTTP fetches
const publicDir = path.join(rootDir, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
const versionJsonPath = path.join(publicDir, 'version.json');
fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

// 2. Write src/environments/version.ts for compiled bundle reference
const envDir = path.join(rootDir, 'src', 'environments');
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

console.log(`[generate-version] Generated version ${version} (buildTime: ${buildTime})`);
