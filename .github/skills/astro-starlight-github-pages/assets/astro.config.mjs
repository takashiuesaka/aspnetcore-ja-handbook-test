// @ts-check
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { rehypeMarkdownLinks } from './plugins/rehype-markdown-links.mjs';

// ---- 対象リポジトリに合わせて書き換える ----
// user.github.io/repo で公開      → site: 'https://user.github.io', BASE: '/repo'
// user.github.io（専用リポジトリ） → site: 'https://user.github.io', BASE: '/'
// 独自ドメイン                     → site: 'https://example.com',    BASE: '/'
const SITE = 'https://<ユーザー名>.github.io';
const BASE = '/<リポジトリ名>';
// ------------------------------------------

export default defineConfig({
	site: SITE,
	base: BASE,
	markdown: {
		// Astro v7 以降の形式。markdown.rehypePlugins を直接書くのは非推奨。
		processor: unified({
			rehypePlugins: [[rehypeMarkdownLinks, { base: BASE }]],
		}),
	},
	integrations: [
		// Mermaid のコードブロックを図として描画する。
		// Starlight 単体では Mermaid に対応しておらず、
		// 未導入だと flowchart TD / gantt などが生テキストのまま表示される。
		//
		// 注意: 必ず starlight() より前に置くこと。
		// 後ろに置くと Starlight のコードブロック処理が先に走り、図にならない。
		//
		// md に mermaid ブロックが 1 件も無い場合は、この import と
		// integration ごと削除してよい（依存も不要になる）。
		mermaid({
			theme: 'default',
			// Starlight のダーク/ライト切替（data-theme 属性）に追従させる。
			autoTheme: true,
			enableLog: false,
		}),
		starlight({
			title: '<サイトタイトル>',
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
