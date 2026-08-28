import { defineConfig } from "vite";
import { copyFileSync, writeFileSync } from "fs";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: "index.html",
        preview: "preview.html",
        content: "src/content.js",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep content.js unhashed for Chrome extension loader compatibility
          return chunkInfo.name === "content"
            ? "[name].js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]", // ✅ Adds hash to CSS & other assets
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifestFilename: "manifest.webmanifest",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,hdr,scad}"],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        skipWaiting: true, // Forces the waiting service worker to become active
        clientsClaim: true, // Takes control of open clients immediately
      },
      manifest: {
        name: "Scadify",
        short_name: "Scadify",
        description:
          "A modern, web-based editor and 3D viewer for OpenSCAD supporting WebAssembly compilation, PBR materials, skeletal animations, and texture baking.",
        theme_color: "#222222",
        background_color: "#222222",
        display: "standalone",
        id: ".",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "icon.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
    {
      name: "copy-extension-files",
      writeBundle() {
        copyFileSync("manifest.json", "dist/manifest.json");
        copyFileSync("src/content.css", "dist/content.css");
        writeFileSync(
          "dist/content-loader.js",
          `// Workaround for Chrome Extension ES modules
(async () => {
  await import(chrome.runtime.getURL("content.js"));
})();`,
        );
      },
    },
  ],
});
