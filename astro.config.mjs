import { defineConfig } from 'astro/config'
import { unified } from '@astrojs/markdown-remark'
import sitemap from '@astrojs/sitemap'
import remarkDirective from 'remark-directive'
import remarkLesson from './src/markdown/remark-lesson.ts'

// learn.oncut.gr: a static site, one HTML page per lesson.
// Served by Plesk from the deploy branch; security headers come from
// public/.htaccess, HSTS from Plesk.
export default defineConfig({
  site: 'https://learn.oncut.gr',
  output: 'static',
  trailingSlash: 'always',
  // npm run dev and npm run preview
  server: { port: 8193 },
  // Keep the HTML-aware whitespace handling of Astro 6, as oncut-web does:
  // Astro 7's default joins words around inline elements across line breaks.
  compressHTML: true,
  integrations: [sitemap()],
  markdown: {
    // Both themes as CSS variables, no inline colors: global.css picks one by
    // the reader's color scheme, and the block background stays the site's.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
    processor: unified({
      remarkPlugins: [remarkDirective, remarkLesson],
      // Greek text uses « »; straight quotes and -- in commands stay as typed.
      smartypants: false,
    }),
  },
  vite: {
    build: {
      // Never inline scripts into the HTML, so the CSP needs no 'unsafe-inline'
      // in script-src (public/.htaccess).
      assetsInlineLimit: 0,
    },
  },
})
