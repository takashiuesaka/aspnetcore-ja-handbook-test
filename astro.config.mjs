// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { rehypeMarkdownLinks } from './plugins/rehype-markdown-links.mjs';
import { remarkGithubAlerts } from './plugins/remark-github-alerts.mjs';

// ---- 対象リポジトリに合わせて書き換える ----
// user.github.io/repo で公開      → site: 'https://user.github.io', BASE: '/repo'
// user.github.io（専用リポジトリ） → site: 'https://user.github.io', BASE: '/'
// 独自ドメイン                     → site: 'https://example.com',    BASE: '/'
const SITE = 'https://takashiuesaka.github.io';
const BASE = '/aspnetcore-ja-handbook-test';
// ------------------------------------------

export default defineConfig({
	site: SITE,
	base: BASE,
	markdown: {
		// Astro v7 以降の形式。markdown.rehypePlugins を直接書くのは非推奨。
		processor: unified({
			// Starlight のプラグインは後から push されるため、
			// アラート変換は必ずここで先に走る。
			remarkPlugins: [remarkGithubAlerts],
			rehypePlugins: [[rehypeMarkdownLinks, { base: BASE }]],
		}),
	},
	integrations: [
		starlight({
			title: 'ASP.NET Core ハンドブック',
			defaultLocale: 'root',
			locales: {
				root: { label: '日本語', lang: 'ja' },
			},
			// sidebar は未設定にしておく。
			// 未設定なら src/content/docs/ 配下から自動生成され、
			// 並び順は slug（フォルダ名）順になる。
			// → 01-, 02- ... の連番プレフィックスがそのまま並び順になる。
			//
			// 注意: frontmatter の title は並び順に一切影響しない。
			//
			// 明示的にグループ分けしたい場合のみ、以下のように書く。
			// 存在しない directory を指定してもエラーにならず、
			// その項目が黙って消えるだけなので必ず実在するパスを指定すること。
			// sidebar: [
			// 	{ label: 'はじめに', slug: 'index' },
			// 	// Starlight v0.39 以降の書式。
			// 	// 旧: { label: 'x', autogenerate: {...} } はエラーになる。
			// 	{ label: 'ガイド', items: [{ autogenerate: { directory: 'guides' } }] },
			// ],
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			pagination: true,
			// GitHub のソースへのリンクを出す場合
			// editLink: { baseUrl: 'https://github.com/<owner>/<repo>/edit/main/' },
		}),
	],
});
