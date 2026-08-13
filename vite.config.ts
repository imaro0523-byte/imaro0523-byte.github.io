import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Content-Security-Policy.
 *
 * An earlier version used `default-src 'self'` with `connect-src 'self'` and
 * called that the strongest possible guarantee. An audit proved otherwise: a
 * probe that tried fifteen egress routes got eight of them delivered to the
 * server, because "self" is a real web server with real access logs. A single
 * line — `new Image().src = '/?d=' + names` — was enough to put a class list
 * into the host's logs. The cross-origin half of the promise held; the
 * same-origin half did not exist.
 *
 * So the policy is now default-deny, and every directive that could carry data
 * outward is closed rather than pointed at 'self':
 *
 *   connect-src 'none'   kills fetch, XHR, sendBeacon, EventSource, WebSocket
 *   img-src data: blob:  kills image beacons and CSS url() — note: no 'self'
 *   default-src 'none'   kills iframe, prefetch and anything not listed below
 *   font-src 'none'      nothing here loads a font file; system fonts only
 *
 * `script-src 'self'` and `worker-src 'self'` have to stay: the app is made of
 * same-origin scripts. They can fetch nothing, so they cannot carry data out.
 *
 * `frame-ancestors` is deliberately absent. The specification requires
 * browsers to ignore it when it arrives in a meta tag, so listing it here
 * would only look like protection. It lives in `public/_headers` instead, for
 * hosts that can send real response headers.
 */
function cspFor(mode: string): string {
  const directives = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    // No 'self': same-origin images are an exfiltration channel through the
    // host's access log. The favicon is inlined as a data: URI to compensate.
    "img-src data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  if (mode === 'development') {
    // Vite's HMR needs a websocket and refetches modules as they change.
    directives.push(
      "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
    );
  } else {
    directives.push("connect-src 'none'");
  }

  return directives.join('; ');
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
  define: {
    // A version string for bug reports. Nothing about the build machine.
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
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
