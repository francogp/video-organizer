import fs from 'node:fs';
import path from 'node:path';

import { vitePrecompressPlugin } from '@francogp/auditor';
import vue from '@vitejs/plugin-vue';
import type { PluginOption } from 'vite-plus';

const DEFAULT_DEV_CLIENT_PORT = 5173;
const DEFAULT_API_PORT = 3000;
const MIN_COMPRESS_BYTES = 512;

function resolveAppSemver(): string {
  const raw = fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as { version?: string };
  const rawSemver = (parsed.version ?? '0.0.0').split('+')[0]?.trim() ?? '0.0.0';
  const base = rawSemver.replace(/-build\..*$/, '');
  return `v${base}`;
}

function resolvePort(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const viteClientPort = resolvePort(process.env.DEV_CLIENT_PORT, DEFAULT_DEV_CLIENT_PORT);
const viteApiTarget = `http://127.0.0.1:${String(resolvePort(process.env.APP_PORT, DEFAULT_API_PORT))}`;
const appSemver = resolveAppSemver();

const devProxyPlugin: PluginOption = {
  name: 'plex-video-organizer-dev-proxy',
  config() {
    return {
      define: {
        __APP_SEMVER__: JSON.stringify(appSemver)
      },
      server: {
        port: viteClientPort,
        strictPort: true,
        watch: {
          ignored: ['**/scratch/**', '**/data/**', '**/dist/**']
        },
        proxy: {
          '/api': {
            target: viteApiTarget,
            changeOrigin: true
          }
        }
      }
    };
  }
};

export const plugins: PluginOption[] = [
  vue(),
  devProxyPlugin,
  vitePrecompressPlugin({
    server: 'nginx',
    spa: true,
    report: 'summary',
    threshold: MIN_COMPRESS_BYTES
  }) as PluginOption
];
