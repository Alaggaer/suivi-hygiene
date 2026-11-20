import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// PWA : l'app s'installe sur la tablette et s'ouvre même sans réseau (fichiers de l'app gardés en cache).
// Les appels à Supabase ne sont jamais mis en cache ici : c'est la file d'envoi et le cache de l'app qui gèrent le hors ligne.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Suivi Hygiène",
        short_name: "Hygiène",
        description: "Suivi d'hygiène des restaurants : relevés, livraisons, traçabilité, anomalies.",
        lang: "fr",
        start_url: "./",
        scope: "./",
        display: "standalone",
        orientation: "any",
        background_color: "#e9edf0",
        theme_color: "#14202b",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        navigateFallback: "index.html",
        runtimeCaching: [{
          urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
          handler: "CacheFirst",
          options: { cacheName: "polices", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
        }],
      },
    }),
  ],
  base: "./",
});
