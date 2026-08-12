import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

/**
 * Content-Security-Policy.
 *
 * `connect-src 'self'` is the structural guarantee behind this app's privacy promise:
 * the browser itself refuses every fetch / XHR / WebSocket / sendBeacon to any other
 * origin, no matter what application code or a third-party dependency tries to do.
 * There is no backend, so 'self' can only ever reach the static build assets.
 *
 * Dev mode additionally allows the localhost websocket used by Vite's HMR.
 */
function cspFor(mode: string): string {
  const connect =
    mode === 'development'
      ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
      : "connect-src 'self'";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    connect,
    // data: / blob: are needed for locally generated PNG · PDF · XLSX downloads.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

/** Injects the CSP meta tag so it is present in dev, preview and production alike. */
function cspPlugin(mode: string) {
  return {
    name: 'seat-planner-csp',
    transformIndexHtml(html: string) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${cspFor(mode)}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the same build works at a domain root and under a
  // GitHub Pages project subpath (https://user.github.io/seat-planner/).
  base: './',
  plugins: [
    react(),
    cspPlugin(mode),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null, // registration is explicit and user-visible, see src/lib/pwa.ts
      workbox: {
        // App shell only. User data never reaches the cache because the app
        // never issues a network request for it in the first place.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [], // explicitly no runtime caching
      },
      includeAssets: ['icon.svg'],
      manifest: {
        name: '자리배치 도우미',
        short_name: '자리배치',
        description: '브라우저 안에서만 처리하는 교실 자리 배치 · 짝 배치 · 모둠 편성 도구',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1d4ed8',
        // A single scalable SVG, bundled with the app. Referencing a PNG on a
        // CDN would be the one network request this project must not make.
        icons: [
          { src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    sourcemap: false, // keeps the production bundle free of source paths
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173 },
}));
