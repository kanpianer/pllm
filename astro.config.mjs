import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://alert.example.com',
  server: {
    port: 4321,
    host: true,
    allowedHosts: true,
  },
  build: {
    format: 'directory',
  },
});
