import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://alert.example.com',
  build: {
    format: 'directory',
  },
});
