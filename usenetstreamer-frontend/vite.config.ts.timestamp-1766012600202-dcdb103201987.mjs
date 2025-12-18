// vite.config.ts
import { defineConfig } from "file:///workspaces/UsenetStreamer/usenetstreamer-frontend/node_modules/.deno/vite@7.2.6_1/node_modules/vite/dist/node/index.js";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "file:///workspaces/UsenetStreamer/usenetstreamer-frontend/node_modules/.deno/@tailwindcss+vite@4.1.17_1/node_modules/@tailwindcss/vite/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [fresh(), tailwindcss()],
  server: {
    watch: {
      usePolling: true,
      interval: 100,
      ignored: ["**/.git/**", "**/node_modules/**"]
    },
    host: "0.0.0.0"
    // 5. (Optional) Explicitly set HMR port if you have issues, and forward this port in devcontainer.json
    // hmr: {
    //   port: 24678, // Default Vite HMR port
    // },
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlUm9vdCI6ICJmaWxlOi8vL3dvcmtzcGFjZXMvVXNlbmV0U3RyZWFtZXIvdXNlbmV0c3RyZWFtZXItZnJvbnRlbmQvIiwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvd29ya3NwYWNlcy9Vc2VuZXRTdHJlYW1lci91c2VuZXRzdHJlYW1lci1mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3dvcmtzcGFjZXMvVXNlbmV0U3RyZWFtZXIvdXNlbmV0c3RyZWFtZXItZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3dvcmtzcGFjZXMvVXNlbmV0U3RyZWFtZXIvdXNlbmV0c3RyZWFtZXItZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHsgZnJlc2ggfSBmcm9tIFwiQGZyZXNoL3BsdWdpbi12aXRlXCI7XG5pbXBvcnQgdGFpbHdpbmRjc3MgZnJvbSBcIkB0YWlsd2luZGNzcy92aXRlXCI7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtmcmVzaCgpLCB0YWlsd2luZGNzcygpXSxcbiAgc2VydmVyOiB7XG4gICAgd2F0Y2g6IHtcbiAgICAgIHVzZVBvbGxpbmc6IHRydWUsXG4gICAgICBpbnRlcnZhbDogMTAwLFxuICAgICAgaWdub3JlZDogWycqKi8uZ2l0LyoqJywgJyoqL25vZGVfbW9kdWxlcy8qKiddLFxuICAgIH0sXG4gICAgaG9zdDogXCIwLjAuMC4wXCIsXG4gICAgLy8gNS4gKE9wdGlvbmFsKSBFeHBsaWNpdGx5IHNldCBITVIgcG9ydCBpZiB5b3UgaGF2ZSBpc3N1ZXMsIGFuZCBmb3J3YXJkIHRoaXMgcG9ydCBpbiBkZXZjb250YWluZXIuanNvblxuICAgIC8vIGhtcjoge1xuICAgIC8vICAgcG9ydDogMjQ2NzgsIC8vIERlZmF1bHQgVml0ZSBITVIgcG9ydFxuICAgIC8vIH0sXG4gIH0sXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQXdVLFNBQVMsb0JBQW9CO0FBQ3JXLFNBQVMsYUFBYTtBQUN0QixPQUFPLGlCQUFpQjtBQUV4QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxHQUFHLFlBQVksQ0FBQztBQUFBLEVBQ2hDLFFBQVE7QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFlBQVk7QUFBQSxNQUNaLFVBQVU7QUFBQSxNQUNWLFNBQVMsQ0FBQyxjQUFjLG9CQUFvQjtBQUFBLElBQzlDO0FBQUEsSUFDQSxNQUFNO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQUtSO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
