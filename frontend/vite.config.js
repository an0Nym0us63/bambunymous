import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // les bibliotheques a part : elles changent rarement, le navigateur les garde
        // d'une version de l'appli a l'autre (seul notre code est retelecharge)
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("lucide-react")) return "vendor-icons";
          // three.js (la vue 3D) : charge seulement a l'ouverture de la vue, jamais avec le reste de l'appli
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return undefined;
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/uploads": "http://localhost:8000",
    },
  },
});
