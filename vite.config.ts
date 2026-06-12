import { defineConfig } from "vite";
import { resolve } from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Múltiples páginas: panel principal + ventana overlay
  build: {
    rollupOptions: {
      input: {
        main:             resolve(__dirname, "index.html"),
        overlay:          resolve(__dirname, "overlay.html"),
        overlay_browser:  resolve(__dirname, "overlay-browser.html"),
        overlay_alerts:   resolve(__dirname, "overlay-alerts.html"),
        overlay_streamer: resolve(__dirname, "overlay-streamer.html"),
      },
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Listen on all interfaces (0.0.0.0) so LAN devices (e.g. a phone reaching the
    // overlay at http://<pc-ip>:6767/overlay) can also fetch /src/* from Vite at
    // http://<pc-ip>:1420 in dev mode. TAURI_DEV_HOST, when set, pins a specific host.
    host: host || true,
    // Vite 6 blocks requests whose Host header isn't in allowedHosts (DNS-rebind
    // guard). LAN IPs pass by default, but the "eso.tilin.com" spoof host would be
    // rejected — allow any host since this dev server is only exposed on the LAN.
    allowedHosts: true,
    // The overlay HTML is served by axum on :6767 but its <script type="module">
    // points at Vite on :1420 — a cross-origin module load. Without CORS the
    // browser blocks it and the overlay renders blank on LAN devices (the Tauri
    // window is same-context and unaffected). Allow any origin in dev.
    cors: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
