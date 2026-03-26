export default {
  title: 'ThreadQL',
  description: 'Ask your database anything, right from Slack.',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/threadql_logo-transparent.png',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Setup', link: '/setup/' },
      { text: 'How It Works', link: '/how-it-works/' },
      { text: 'Installation', link: '/installation/' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'What is ThreadQL?', link: '/guide/' },
          { text: 'Installation', link: '/installation/' },
          { text: 'Setup', link: '/setup/' },
        ],
      },
      {
        text: 'Understanding ThreadQL',
        items: [
          { text: 'How It Works', link: '/how-it-works/' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/emtay-com/threadql' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright 2025-present emtay',
    },
  },
}
