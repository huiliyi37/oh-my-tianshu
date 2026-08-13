/** VitePress configuration for the locally projected documentation site. */

import type { DefaultTheme, PageData } from 'vitepress'
import type { ViteDevServer } from 'vite'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { docsPages, type DocsPage } from '../docs.ts'
import { docsSourceFiles, projectDocs } from '../../scripts/project-doc-site.ts'

projectDocs()

const sectionOrder = [
  '入门',
  '基础',
  '框架能力',
  '实战',
  'Cordis 教程',
  '概念',
  '生成参考',
  'Cordis API',
  '数据结构',
  '开发手册',
  'Guide',
  'Basics',
  'Framework',
  'Practice',
  'Cordis tutorial',
  'Concepts',
  'Generated reference',
  'Cordis Core API',
  'Data structures',
  'Cookbook',
]

function sidebar(collection: DocsPage['sidebar']): DefaultTheme.SidebarItem[] {
  const pages = docsPages.filter(page => page.sidebar === collection)
  const sections = new Map<string, DocsPage[]>()
  for (const page of pages) {
    const entries = sections.get(page.section) ?? []
    entries.push(page)
    sections.set(page.section, entries)
  }
  return [...sections.entries()]
    .sort(([left], [right]) => sectionOrder.indexOf(left) - sectionOrder.indexOf(right))
    .map(([text, entries]) => ({
      text,
      items: entries
        .sort((left, right) => left.order - right.order)
        .map(page => ({ text: page.label, link: `/${page.route.replace(/(?:index)?\.md$/, '')}` })),
    }))
}

function watchCanonicalDocs(server: ViteDevServer): void {
  const sources = docsSourceFiles()
  server.watcher.add(sources)
  server.watcher.on('change', (changed) => {
    if (!sources.includes(changed)) return
    projectDocs()
  })
}

function escapeVueInterpolation(html: string): string {
  return html.replaceAll('{{', '&#123;&#123;').replaceAll('}}', '&#125;&#125;')
}

const sharedTheme: Pick<DefaultTheme.Config, 'search' | 'socialLinks' | 'editLink'> = {
  search: {
    provider: 'local',
    options: {
      locales: {
        root: {
          translations: {
            button: {
              buttonText: '搜索文档',
              buttonAriaLabel: '搜索文档',
            },
            modal: {
              displayDetails: '显示详细列表',
              resetButtonTitle: '清除搜索',
              backButtonTitle: '关闭搜索',
              noResultsText: '未找到相关结果',
              footer: {
                selectText: '选择',
                selectKeyAriaLabel: '回车键',
                navigateText: '切换',
                navigateUpKeyAriaLabel: '上方向键',
                navigateDownKeyAriaLabel: '下方向键',
                closeText: '关闭',
                closeKeyAriaLabel: 'Esc 键',
              },
            },
          },
        },
      },
    },
  },
  socialLinks: [
    { icon: 'github', link: 'https://github.com/deepseek-ai/deepseek-harness-sdk' },
  ],
  editLink: {
    pattern: ({ frontmatter }: PageData) => {
      const data: unknown = frontmatter
      const editSource: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'editSource') : undefined
      if (typeof editSource !== 'string') throw new Error('Projected documentation page has no editSource frontmatter.')
      return `https://github.com/deepseek-ai/deepseek-harness-sdk/edit/master/${editSource}`
    },
    text: '在 GitHub 上编辑此页',
  },
}

export default withMermaid({
  title: 'DeepSeek Harness',
  description: '用于构建 Agent Harness 的插件化 SDK',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  srcDir: '.generated',
  cacheDir: '.cache',
  outDir: '.dist',
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: {
        nav: [
          { text: '入门', link: '/guide/', activeMatch: '^/guide/' },
          { text: '开发', link: '/develop/basic/', activeMatch: '^/develop/' },
          { text: '参考', link: '/reference/', activeMatch: '^/reference/' },
        ],
        sidebar: {
          '/guide/': sidebar('zh-guide'),
          '/develop/': sidebar('zh-develop'),
          '/reference/': sidebar('zh-reference'),
        },
        outline: { label: '本页目录' },
        docFooter: { prev: '上一篇', next: '下一篇' },
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色主题',
        darkModeSwitchTitle: '切换到深色主题',
        sidebarMenuLabel: '菜单',
        returnToTopLabel: '返回顶部',
        langMenuLabel: '切换语言',
        skipToContentLabel: '跳至内容',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/', activeMatch: '^/en/guide/' },
          { text: 'Develop', link: '/en/develop/basic/', activeMatch: '^/en/develop/' },
          { text: 'Reference', link: '/en/reference/', activeMatch: '^/en/reference/' },
        ],
        sidebar: {
          '/en/guide/': sidebar('en-guide'),
          '/en/develop/': sidebar('en-develop'),
          '/en/reference/': sidebar('en-reference'),
        },
        editLink: {
          pattern: ({ frontmatter }: PageData) => {
            const data: unknown = frontmatter
            const editSource: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'editSource') : undefined
            if (typeof editSource !== 'string') throw new Error('Projected documentation page has no editSource frontmatter.')
            return `https://github.com/deepseek-ai/deepseek-harness-sdk/edit/master/${editSource}`
          },
          text: 'Edit this page on GitHub',
        },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
      },
    },
  },
  vite: {
    plugins: [
      {
        name: 'deepseek-harness-doc-projector',
        configureServer: watchCanonicalDocs,
      },
    ],
  },
  markdown: {
    config(md) {
      const renderText = md.renderer.rules.text
      const renderCode = md.renderer.rules.code_inline
      if (renderText === undefined || renderCode === undefined) {
        throw new Error('VitePress Markdown renderer is missing its text or inline-code rule.')
      }
      md.renderer.rules.text = (...args) => escapeVueInterpolation(renderText(...args))
      md.renderer.rules.code_inline = (...args) => escapeVueInterpolation(renderCode(...args))
    },
  },
  mermaid: {},
  themeConfig: sharedTheme,
})
