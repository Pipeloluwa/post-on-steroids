/**
 * ============================================================================
 * DESKTOP DOWNLOADS & HOMEPAGE LINKS CONFIGURATION
 * ============================================================================
 * Easily configure the Homepage app URL, the dedicated download landing page,
 * and the download packages available to users on the browser client.
 */

export interface DesktopPackage {
  os: 'windows' | 'linux' | 'mac';
  osName: string;
  name: string;
  filename: string;
  format: string;
  size: string;
  isPrimary?: boolean;
  badge?: string;
  description: string;
}

export interface DesktopDownloadsConfig {
  /**
   * Root URL of the Homepage application
   * e.g. 'https://onsteroid.com' or 'http://localhost:4300'
   */
  homepageUrl: string;

  /**
   * Dedicated URL for the Homepage App's Download page
   * e.g. 'https://onsteroid.com/download'
   */
  homepageDownloadUrl: string;

  /**
   * Relative or absolute path where built installer files are located
   * e.g. '/downloads' -> '/downloads/OnSteroid-Setup.exe'
   * e.g. ''           -> '/OnSteroid-Setup.exe'
   */
  downloadsDirectoryUrl: string;

  /**
   * List of all desktop download packages available across platforms
   */
  packages: DesktopPackage[];
}

export const DESKTOP_DOWNLOADS_CONFIG: DesktopDownloadsConfig = {
  // Configurable Homepage URL
  homepageUrl: 'https://onsteroid.com',
  homepageDownloadUrl: 'https://onsteroid.com/download',
  downloadsDirectoryUrl: 'https://onsteroid.com/download',

  packages: [
    {
      os: 'windows',
      osName: 'Windows',
      name: 'Windows Installer (64-bit)',
      filename: 'OnSteroid-Setup.exe',
      format: '.exe',
      size: '~138 MB',
      isPrimary: true,
      badge: 'Recommended',
      description: 'Full NSIS installer with desktop shortcut and seamless auto-updater.'
    },
    {
      os: 'windows',
      osName: 'Windows',
      name: 'Windows Portable (64-bit)',
      filename: 'OnSteroid-win-x64.zip',
      format: '.zip',
      size: '~140 MB',
      description: 'Zero install required. Unzip anywhere and double-click to launch.'
    },
    {
      os: 'linux',
      osName: 'Linux',
      name: 'Linux Standalone Package (x64)',
      filename: 'OnSteroid-linux-x64.tar.gz',
      format: '.tar.gz',
      size: '~169 MB',
      isPrimary: true,
      badge: 'Linux Default',
      description: 'Standard tarball for Ubuntu, Debian, Fedora, Arch, CentOS. Extract & run.'
    },
    {
      os: 'linux',
      osName: 'Linux',
      name: 'Linux Portable Archive (x64)',
      filename: 'OnSteroid-linux-x64.zip',
      format: '.zip',
      size: '~169 MB',
      description: 'Portable zip archive for all modern 64-bit Linux distributions.'
    },
    {
      os: 'mac',
      osName: 'macOS',
      name: 'macOS Universal (Apple Silicon & Intel)',
      filename: 'OnSteroid.dmg',
      format: '.dmg',
      size: 'Universal',
      description: 'macOS disk image installer. Drag into Applications folder.'
    }
  ]
};

/**
 * Helper to build the direct download URL for a given package
 */
export function buildDownloadLink(pkg: DesktopPackage, config: DesktopDownloadsConfig = DESKTOP_DOWNLOADS_CONFIG): string {
  const base = config.downloadsDirectoryUrl.replace(/\/+$/, '');
  return base ? `${base}/${pkg.filename}` : `/${pkg.filename}`;
}
