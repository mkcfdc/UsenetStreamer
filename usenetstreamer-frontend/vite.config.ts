import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [fresh(), tailwindcss()],
  server: {
    watch: {
      usePolling: true,
      interval: 100,
      ignored: ['**/.git/**', '**/node_modules/**'],
    },
    host: "0.0.0.0",
    // 5. (Optional) Explicitly set HMR port if you have issues, and forward this port in devcontainer.json
    // hmr: {
    //   port: 24678, // Default Vite HMR port
    // },
  },
});