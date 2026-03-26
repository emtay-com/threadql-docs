import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'

const publicDir = fileURLToPath(new URL('../../images', import.meta.url))

export default defineConfig({
  title: 'ThreadQL Docs',
  description: 'Comprehensive documentation for ThreadQL - Natural Language to SQL Query System',
  base: '/',
  vite: {
    publicDir
  },

  themeConfig: {
    logo: '/threadql_logo.png',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'How It Works', link: '/how-it-works/' },
      { text: 'Installation', link: '/installation/' },
      { text: 'Setup', link: '/setup/' },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/emtay-com/threadql' }
    ],

    sidebar: {
      '/': [
        {
          text: 'Documentation',
          items: [
            { text: 'Guide', link: '/guide/' },
            { text: 'How It Works', link: '/how-it-works/' },
            { text: 'Installation', link: '/installation/' },
            { text: 'Setup ThreadQL', link: '/setup/' }
          ]
        }
      ]
    }
  },

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48x48.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '96x96', href: '/favicon-96x96.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '120x120', href: '/apple-touch-icon-120x120.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '152x152', href: '/apple-touch-icon-152x152.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '167x167', href: '/apple-touch-icon-167x167.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon-180x180.png' }]
  ]
})
