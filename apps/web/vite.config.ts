import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  server: {
    port: 3000,
    proxy: {
      '/graphql': 'http://127.0.0.1:4000',
      '/api': 'http://127.0.0.1:4000',
      '/thumbnails': 'http://127.0.0.1:4000',
      '/media': 'http://127.0.0.1:4000',
      '/hls': 'http://127.0.0.1:4000',
      '/image': 'http://127.0.0.1:4000',
      '/video': 'http://127.0.0.1:4000',
      '/download': 'http://127.0.0.1:4000',
      '/download-zip': 'http://127.0.0.1:4000',
      '/file-preview': 'http://127.0.0.1:4000',
      '/compress-preview': 'http://127.0.0.1:4000',
      '/health': 'http://127.0.0.1:4000',
    },
  },
});
