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
        overlay_tiktok:   resolve(__dirname, "overlay-tiktok.html"),
        overlay_streamer: resolve(__dirname, "overlay-streamer.html"),
      },
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
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
