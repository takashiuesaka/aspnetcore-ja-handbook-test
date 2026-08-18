---
name: astro-starlight-github-pages
description: "既存の GitHub リポジトリ（Markdown が /docs、画像が /images または /docs/images にある構成）を Astro + Starlight でドキュメントサイト化し、GitHub Pages に公開するためのスキル。移行方針の判断、docs の配置、フラットな md 群からページ単位フォルダ構成への再構成、画像パスと md 間リンクの解決、base 設定によるサブパス公開の落とし穴、GitHub Actions でのデプロイまでを扱う。次のような依頼で使用する: 「/docs の md を GitHub Pages で公開したい」「Astro でドキュメントサイトを作りたい」「Starlight を導入したい」「GitHub Pages で CSS やリンクが 404 になる」「md の画像が公開サイトで表示されない」「docs を静的サイトにしたい」「docs のフォルダ構成を整理したい」。単なる Astro の一般的な質問や、docs/ を持たない新規サイト構築には使わない。"
---

# Astro + Starlight で既存 /docs を GitHub Pages 公開する

## 前提とする既存構成

```
repo/
├── docs/          # Markdown 群
├── images/        # docs から参照される画像
└── README.md
```

または、画像が `docs/` の中に集約されている構成:

```
repo/
├── docs/
│   ├── images/    # 全ページ分の画像が混在
│   ├── 01-xxx.md
│   └── 02-yyy.md
└── README.md
```

これを Astro + Starlight でビルドし、GitHub Pages に公開する。

## 最重要原則

1. **画像と md 間リンクは必ず「相対パス」で書く。** 絶対パス（`/images/...`）は `base` が付与されず 404 になる。
2. **`base` を設定したら必ず `npm run build` + `npm run preview` で確認する。** `npm run dev` だけでは本番相当の検証にならない。
3. **md 間の `.md` リンクは Astro も Starlight も変換しない。** 素の状態ではリンク切れになるため、後述の rehype プラグインが必須。
4. **frontmatter の `title` は必須。** 無いとビルドが失敗する。既存 md 全件の確認が最初の関門。
5. **Starlight は Mermaid に対応していない。** Mermaid のコードブロックは素の状態では `flowchart TD ...` という生テキストで表示される。エラーも警告も出ないため、ステップ 1 で必ず有無を数える。

## 手順

### ステップ 1: 事前調査（実装前に必ず行う）

以下を調べ、作業量を見積もる。

```bash
# md の総数
find docs -name "*.md" | wc -l

# frontmatter が無い md（title 追加が必要）
for f in $(find docs -name "*.md"); do head -1 "$f" | grep -q '^---$' || echo "$f"; done

# title が無い md
for f in $(find docs -name "*.md"); do grep -q '^title:' "$f" || echo "$f"; done

# 絶対パス画像参照（修正必要）
grep -rn '](/images/' docs/ ; grep -rn 'src="/images/' docs/

# HTML img タグ直書き（修正必要）
grep -rn '<img ' docs/

# md 間リンク（相対）
grep -rnE '\]\([^)]*\.md' docs/

# md 間リンク（リポジトリ絶対パス /docs/... 形式。プラグインでは変換されないため要修正）
grep -rnE '\]\(/[^)]*\.md' docs/

# 本文中の h1（frontmatter title と重複する）
grep -rn '^# ' docs/

# 参照されていない画像（削除候補の洗い出し）
for img in $(ls images/); do grep -rq "$img" docs/ || echo "未使用: images/$img"; done

# Mermaid コードブロック（Starlight 単体では図にならない。あれば astro-mermaid が必要）
grep -rc '^```mermaid' docs/ | grep -v ':0$'
grep -rhA1 '^```mermaid' docs/ | grep -vE '^```mermaid|^--' | awk '{print $1}' | sort | uniq -c

# 画像の置き場所パターンを判定（docs/images/ があればページ単位フォルダへの再構成を検討）
ls -d docs/images images 2>/dev/null; true

# 各 md が参照している画像の一覧（再構成時の移動計画に使う）
# Markdown 記法と HTML の <img> の両方を拾う
for f in docs/*.md; do
  echo "== $f"
  grep -oiE '[A-Za-z0-9._-]+\.(png|jpe?g|gif|svg|webp)' "$f" | sort -u
done
```

> **画像ファイル名に `01-01_xxx.png` のような番号が付いている場合**、先頭の番号が対応する md（`01-setup-dev-env.md`）を示している命名規則であることが多い。再構成時の振り分けの手がかりになるが、**規則から外れた参照（別章の画像を使い回している、番号に対応する md が存在しない等）が混ざっていることがある**。必ず上記の grep による実際の参照関係を正とし、ファイル名は補助的な確認にとどめる。
>
> ```bash
> # ファイル名の番号と実際の参照先が一致しているかを突き合わせる
> for i in $(ls docs/images/); do
>   echo "$i -> $(grep -l "$i" docs/*.md | tr '\n' ' ')"
> done
> ```

### ステップ 2: docs の配置方針を決める

#### 2-a. まず既存の構成パターンを判定する

| パターン | 既存構成 | 対応 |
| --- | --- | --- |
| A: 画像がリポジトリ直下 | `docs/*.md` + `images/` | 2-b へ（移動するか据え置くかの判断） |
| B: 画像が docs 配下に集約 | `docs/*.md` + `docs/images/` | **2-c の再構成を強く推奨** |

パターン B（`docs/images/` に全ページ分の画像が混在）は、ページ数が増えるほど画像とページの対応が追えなくなる。Astro 移行はこれを直す好機なので、**ページ単位フォルダ構成（コロケーション）への再構成を提案する。**

```bash
# パターン判定
ls -d docs/images images 2>/dev/null
ls docs/*.md | head
```

#### 2-b. `src/content/docs/` へ移動するか、`docs/` のまま使うか

ユーザーに確認する。**勝手に決めない。**

| 方式 | `src/content/docs/` へ移動 | `docs/` のまま |
| --- | --- | --- |
| Starlight 公式サポート | 正式 | 非公式（ソースに「パス固定」と明記あり） |
| ローダー | `docsLoader()` | `glob({ base: './docs' })` |
| 最終更新日の自動表示 | 動く | 動かない可能性 |
| i18n（多言語） | 動く | 動かない |
| GitHub 上の `docs/xxx.md` リンク | 全て 404 になる | 維持される |
| README や issue からの参照 | 要修正 | 維持される |

**判断基準**: `docs/` へ外部リンクが張られているか。張られていなければ移動、張られていれば据え置きが安全。

移動する場合は履歴を保つ:

```bash
mkdir -p src/content
git mv docs src/content/docs
```

#### 2-c. ページ単位フォルダ構成（コロケーション）への再構成

`docs/*.md` がフラットに並び、画像が `docs/images/` に集約されている構成は、**1ページ = 1フォルダ**に組み替える。

**移行前**

```
docs/
├── images/                      # 全ページの画像が混在
│   ├── vs-install.png
│   └── project-tree.png
├── 01-setup-dev-env.md
├── 02-solutions-and-projects.md
└── 03-mvc-web-and-api.md
```

**移行後**

```
src/content/docs/
├── index.md                     # ← 新規作成するトップページ
├── 01-setup-dev-env/
│   ├── index.md                 # ← 元の 01-setup-dev-env.md
│   └── images/
│       └── vs-install.png       # ← このページが使う画像だけ
├── 02-solutions-and-projects/
│   ├── index.md
│   └── images/
└── 03-mvc-web-and-api/
    ├── index.md
    └── images/
```

**この構成の利点**

- 画像とページが 1 対 1 で対応し、ページを消せば画像も一緒に消せる（孤児画像が発生しない）
- md 内の画像参照が `./images/xxx.png` に統一され、階層数を数えなくてよい（`../../../` のような脆いパスが消える）
- ページの追加・並べ替えがフォルダ操作だけで完結する

**検証済みの挙動**（この構成で実測）

| 項目 | 結果 |
| --- | --- |
| URL | `01-setup-dev-env/index.md` → `/<base>/01-setup-dev-env/` |
| サイドバーの並び順 | **slug（パス）順**。frontmatter の `title` は順序に影響しない |
| サイドバーのラベル | frontmatter の `title` |
| `sidebar` 未設定時 | 全ページがフラットに自動生成される（この構成ではこれで十分） |
| 同居画像 `./images/x.png` | base 付与 + WebP 変換 + `width`/`height` 自動付与 |
| フォルダ内の `images/` | ページとして扱われない（md 以外は無視される） |

**`01-` などの連番プレフィックスは残す。** サイドバーの順序が slug 順で決まるため、これが並び順の制御そのものになる。URL にも `/01-setup-dev-env/` として現れるが、順序制御を frontmatter に持たせるより構成が単純で壊れにくい。
URL から連番を消したい場合のみ、フォルダ名から `01-` を外し、代わりに各 md の frontmatter に `sidebar: { order: 1 }` を書く（ただし全ページに書き漏らしなく入れる必要がある）。

**再構成の手順**

```bash
# 1. ページごとのフォルダを作り、md を index.md として移動する
mkdir -p src/content
git mv docs src/content/docs

cd src/content/docs
for f in *.md; do
  [ "$f" = "index.md" ] && continue
  name="${f%.md}"
  mkdir -p "$name"
  git mv "$f" "$name/index.md"
done

# 2. 各ページが参照している画像を洗い出す
for d in */; do
  echo "== $d"
  grep -oiE '[A-Za-z0-9._-]+\.(png|jpe?g|gif|svg|webp)' "$d/index.md" | sort -u
done
```

```bash
# 3. 洗い出した対応に従って、画像を各ページのフォルダへ移す（1ファイルずつ確認して実行）
mkdir -p 01-setup-dev-env/images
git mv images/vs-install.png 01-setup-dev-env/images/

# 4. md 内の参照を書き換える（例: ./images/ 直下に揃える）
#    移行前: ![](./images/vs-install.png) / ![](../images/vs-install.png) / ![](/docs/images/vs-install.png)
#    移行後: ![](./images/vs-install.png)

# 5. 移し終えたら共有 images/ が空になっているか確認する
ls images/ 2>/dev/null && echo "→ 残っている = どのページからも参照されていない画像"
```

**未使用画像は `src/content/docs/` の中に残さない。**

コンテンツフォルダ配下はページ用の領域なので、`src/content/docs/images/` のような「ページでもフォルダでもないもの」を置くと、後から見た人が「どこかのページが使っている画像」と誤解する。ビルド成果物には出力されないため公開サイトへの実害はないが、必ず外へ出す。

ユーザーに確認した上で、次のいずれかにする。

| 選択肢 | コマンド | 向いているケース |
| --- | --- | --- |
| **リポジトリ直下へ退避（既定）** | `git mv src/content/docs/images images-unused` | 判断を保留したい。後で使うかもしれない |
| 削除 | `git rm src/content/docs/images/xxx.png` | 明らかに不要（履歴には残るので復元可能） |
| どこかのページで使う | 該当ページの `images/` へ移し、md から参照を追加 | 本来載せるべき画像だった |

**勝手に削除しない。** 未使用に見えても、md 以外（README、Wiki、issue 等）から参照されている場合がある。

```bash
# リポジトリ全体で参照が無いかを確認してから判断する
for i in $(ls images-unused/ 2>/dev/null); do
  echo "$i -> $(grep -rl "$i" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | tr '\n' ' ')"
done
```

**注意点**

- **複数ページが同じ画像を参照している場合**は各フォルダへ複製する。Astro は内容が同一の画像を 1 ファイルに重複排除するため、`dist/` のサイズは増えない。
- **トップページ `src/content/docs/index.md` は元の構成に存在しないことが多い**。詳細はステップ 5-b を参照。**内容を推測で創作しない**（「対象読者」「前提知識」などを勝手に書き足さない）。
- 画像を移動したことで、**GitHub 上で元の md を直接見ていた人のリンクが切れる**。2-b と同じ判断が必要。


### ステップ 3: セットアップ

```bash
npm init -y
npm install astro @astrojs/starlight @astrojs/markdown-remark sharp

# ステップ 1 で mermaid ブロックが見つかった場合のみ追加する
npm install astro-mermaid mermaid @mermaid-js/layout-elk
```

> **`@astrojs/markdown-remark` を省略しない。** `astro.config.mjs` がここから `unified` を import する。`astro` の依存として `node_modules` に入るため省略しても動いてしまうことがあるが、npm のフラット配置に依存した偶然であり、依存構造が変わると `Cannot find package` で壊れる。直接 import するものは直接依存に書く。

> **`mermaid` と `@mermaid-js/layout-elk` も明示的に入れる。** どちらも `astro-mermaid` の peerDependency で、入れないと警告のみで install が通り、ビルド時か実行時に落ちる。

`package.json` を修正する。**`"type": "module"` は必須**（`npm init -y` は `commonjs` を出力する。ESM 設定ファイルが読めずエラーになる）。

```json
{
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

> `esbuild` の postinstall がブロックされる警告（npm 11 以降）は無視してよい。esbuild はプラットフォーム別バイナリを別パッケージで配布するため、スクリプト未実行でも動作する。`node -e "require('esbuild').transformSync('const a=1')"` で確認できる。

### ステップ 4: 設定ファイル

`assets/` 配下のテンプレートをコピーして使う。

- `assets/astro.config.mjs` — Astro 本体の設定
- `assets/content.config.ts` — コンテンツコレクション定義（`src/content.config.ts` に置く）
- `assets/rehype-markdown-links.mjs` — md 間リンク解決プラグイン（`plugins/` に置く）
- `assets/feature-build-only.yml` — feature ブランチ用のビルド検証（`.github/workflows/` に置く）
- `assets/main-build-and-publish.yml` — main 用のビルド＋Pages 公開（`.github/workflows/` に置く）
- `assets/gitignore` — `.gitignore` に追記
- `assets/favicon.svg` — `public/favicon.svg` に置く（**必須**）

> **`public/favicon.svg` と `public/.nojekyll` を必ず作る。**
> Starlight は既定で `/favicon.svg` を参照するが**ファイルは同梱されない**ため、置かないと全ページで 404 になる（ビルドは成功するので気づきにくい）。`assets/favicon.svg` は無難な代替。ブランドがあれば差し替える。
> `.nojekyll` は空ファイルでよい。GitHub Pages の Jekyll 処理を止めるためのもので、これが無いと `_astro/` のように**アンダースコア始まりのフォルダが丸ごと無視され、CSS も画像も配信されない**。
>
> ```bash
> mkdir -p public && cp <skill>/assets/favicon.svg public/ && touch public/.nojekyll
> ```

`astro.config.mjs` の `BASE` と `site` は対象リポジトリに合わせて必ず書き換える。

| 公開先 | `site` | `base` |
| --- | --- | --- |
| `user.github.io/repo` | `https://user.github.io` | `/repo` |
| `user.github.io`（専用リポジトリ） | `https://user.github.io` | 不要 |
| 独自ドメイン | `https://example.com` | 不要 |

テンプレートの `SITE` は `https://example.github.io` というプレースホルダになっている。**書き換えを忘れてもビルドは成功し、サイトも一見正常に動く**（`base` と違い、`site` は sitemap と OGP の絶対 URL にしか使われないため）。気づかないまま公開されやすいので、必ず確認する。

> **`sidebar` は未設定のままにする。** 未設定なら `src/content/docs/` から自動生成され、**slug（フォルダ名）順**に並ぶ。`01-`, `02-` の連番プレフィックスがそのまま並び順になるため、ステップ 2-c の構成ではこれで十分。
> frontmatter の `title` は**並び順に一切影響しない**（順序を変えたければフォルダ名を変える）。
>
> **`autogenerate: { directory: 'guides' }` のように存在しないディレクトリを指定しても、エラーにならずその項目が黙って消える。** サイドバーから記事が全部消えたのにビルドは成功する、という事故が起きるので、明示指定する場合は必ず実在するパスを書き、ビルド後にサイドバーの中身を確認する。

> **`mermaid()` は必ず `starlight()` より前に置く。** `integrations` は上から順に適用されるため、後ろに置くと Starlight のコードブロック処理が先に走り、**エラーも警告も出ないまま図にならない**。テンプレートは既に正しい順序になっているので、並べ替えないこと。
>
> ステップ 1 で mermaid ブロックが 0 件だった場合は、`import mermaid` と `mermaid({...})` を削除する（依存も不要）。残したまま `astro-mermaid` を入れ忘れると `Cannot find package` でビルドが落ちる。

```bash
# 実際のアカウント名を取得する
gh api user --jq .login

# プレースホルダが残っていないか確認（何も出なければ OK）
grep -n "example\.github\.io\|example\.com" astro.config.mjs README.md

# ビルド後、sitemap の URL が正しいかを確認する
grep -o '<loc>[^<]*</loc>' dist/sitemap-0.xml | head -3
```

### ステップ 5: md の修正

#### 5-a. 既存 md の修正

| 対象 | 修正前 | 修正後 |
| --- | --- | --- |
| frontmatter 無し | （無し） | `---\ntitle: ページ名\n---` を追加 |
| 本文の h1 | `# ページ名` | 削除（`title` が h1 を生成するため重複する） |
| 画像（絶対パス） | `![](/images/a.png)` | `![](../../../images/a.png)` |
| 画像（HTML 直書き） | `<img src="/images/a.png">` | `![](../../../images/a.png)` |
| md 間リンク（リポジトリ絶対） | `[x](/docs/guides/a.md)` | `[x](./guides/a.md)` |
| md 間リンク（サイト絶対） | `[x](/docs/guides/a/)` | `[x](./guides/a.md)` |
| md 間リンク（相対） | `[x](./guides/a.md)` | **修正不要**（プラグインが変換） |

**`docs/` を移動した場合は、リポジトリ内の他ファイルからの参照も修正する。** README、CONTRIBUTING、issue テンプレート等が `docs/xxx.md` を指していないか確認する。

```bash
grep -rn 'docs/' README.md .github/ --include="*.md" 2>/dev/null | grep -v skills
```

**リンクは必ず相対パスにする。** `rehype-markdown-links.mjs` は `/` で始まる絶対パスを意図的に対象外にしている（外部リンクや意図的な絶対指定を壊さないため）。`/docs/guides/a.md` のようなリポジトリ絶対パス記法は変換されず 404 になるので、相対パスへの書き換えが必須。

相対パスの階層数は md の位置により変わる。`src/content/docs/index.md` からリポジトリ直下の `images/` へは `../../../images/`、`src/content/docs/guides/x.md` からは `../../../../images/`。

**ステップ 2-c のページ単位フォルダ構成を採用した場合は、画像参照はすべて `./images/xxx.png` に統一する。** 階層を数える必要がなくなるため、この構成のほうが誤りが起きにくい。

| 対象 | 修正前 | 修正後（コロケーション構成） |
| --- | --- | --- |
| 画像（同一フォルダ集約） | `![](./images/a.png)` | `![](./images/a.png)`（変わらないが、指す実体が各ページ配下になる） |
| 画像（親を辿る） | `![](../images/a.png)` | `![](./images/a.png)` |
| 画像（リポジトリ絶対） | `![](/docs/images/a.png)` | `![](./images/a.png)` |
| md 間リンク | `[x](./02-solutions-and-projects.md)` | `[x](../02-solutions-and-projects/index.md)` |

> md 間リンクは、md 自体が `NN-name/index.md` へ移動するため相対位置が 1 階層ずれる。`rehype-markdown-links.mjs` は移動後のパスを基準に解決するので、**書き換え漏れはビルドでは検出されない**。ステップ 6 の検証コマンドで必ず確認する。

#### 5-b. トップページ `src/content/docs/index.md` を作る

`docs/` に `index.md` が無い場合、サイトのトップページが存在しないため新規作成する。

**`README.md` の内容を流用するのが既定の方針。** 目次や概要は README に既に書かれていることが多く、ゼロから書くと内容が重複し、二重メンテナンスになる。

> **`README.md` はビルド対象外。** Astro が読むのは `src/content/docs/` 配下だけなので、README をそのまま置いても公開サイトには一切現れない。トップページにするには `src/content/docs/index.md` として内容をコピーする必要がある。

README を流用する際、**次の 3 点だけは必ず変える**（そのままコピーすると壊れる）。

| # | 変更内容 | 理由 |
| --- | --- | --- |
| 1 | frontmatter（`title`・`description`）を追加 | `title` が無いとビルドが失敗する |
| 2 | 先頭の `# タイトル` を削除 | `title` が h1 を生成するため重複する |
| 3 | 相対リンクの階層を調整 | README は `./src/content/docs/xxx/index.md` 起点、index.md は `./xxx/index.md` 起点 |

**本文はそれ以外いじらない。推測で内容を足さない。**

**README 側には公開サイトへの導線を付ける。** GitHub で Markdown を直接読んでいる人を、検索や目次が使えるサイトへ誘導する。

```markdown
# リポジトリ名

> 📖 **読みやすい HTML 版はこちら → https://<user>.github.io/<repo>/**
>
> 以下は Markdown のソースです。検索・目次・ページ送りが使える公開サイトの方が快適に読めます。
```

この 1 ブロックは index.md 側には入れない（自分自身へのリンクになるため）。

**トレードオフを理解した上で採用する。** README と index.md は内容が重複するため、記事を追加したときは両方の目次を更新する必要がある。それを避けたい場合は、開発者向けの節（ローカル確認手順・記事の追加方法など）を `CONTRIBUTING.md` に切り出し、双方から参照する構成もある。**どちらにするかはユーザーに確認する。**

> `README.md` が存在しない、または内容が薄い場合は、各ページへのリンクを並べただけの目次ページとして作る。Starlight のスプラッシュテンプレート（`template: splash`）を使う選択肢もあるが、まずは通常ページで作りユーザーに確認する。


### ステップ 6: 検証

```bash
npm run dev      # http://localhost:4321/<base> で確認
npm run build    # 本番と同じ静的HTML生成
npm run preview  # 本番同等で最終確認
```

`dev` のログに次が出たら、その md の画像パスが絶対パスになっている。

```
[ERROR] [router] Request URLs for public/ assets must also include your base.
"/repo/images/x.png" expected, but received "/images/x.png".
```

ビルド結果を機械的に検証する:

```bash
# base が付いていない絶対パス参照を検出（0件であるべき。<base> は実際の値に置換）
find dist -name "*.html" -exec grep -hoE '(src|href)="/[^"]*"' {} + \
  | grep -v '="/<base>' | sort -u

# 未変換の .md リンクを検出（0件であるべき）
# ※ editLink 有効時は GitHub の編集URLがヒットするため http(s) を除外する
grep -ro 'href="[^"]*\.md"' dist/ | grep -v 'href="http' | head

# h1 の重複を検出（各ページ 1 であるべき）
for f in $(find dist -name "*.html"); do echo "$(grep -c '<h1' $f) $f"; done | grep -v '^1 '

# コンテンツフォルダ内の残骸を検出（index.md を持たないフォルダは 0 件であるべき）
# ページ用の領域に未使用画像などが取り残されていないかの確認。
find src/content/docs -mindepth 1 -type d ! -name images \
  -exec sh -c '[ -f "$1/index.md" ] || echo "ページでないフォルダ: $1"' _ {} \;
find src/content/docs -maxdepth 1 -type d -name images \
  -exec echo "コンテンツ直下に images/ がある（外へ退避すべき）: {}" \;

# 内部リンク切れを検出（0件であるべき）
# プラグインは「存在しない md へのリンク」も機械的に変換してしまうため、
# ページ単位フォルダ構成へ再構成した直後は必ずこれを実行する。<base> は実際の値に置換。
find dist -name "*.html" -exec grep -hoE 'href="/<base>/[^"#?]*"' {} + \
  | sed 's/href="//;s/"//' | sort -u \
  | while read u; do
      p="dist${u#/<base>}"
      [ -f "${p%/}/index.html" ] || [ -f "$p" ] || echo "リンク切れ: $u"
    done

# サイドバーに全ページが出ているかを確認する
# （sidebar の設定ミスでは警告もエラーも出ないため、実物を数える）
node -e "
const fs=require('fs');
const f=process.argv[1];
const h=fs.readFileSync(f,'utf8');
const i=h.indexOf('<nav class=\"sidebar'), j=h.indexOf('</nav>', i);
const items=[...h.slice(i,j).matchAll(/href=\"([^\"]+)\"[^>]*>(?:<span[^>]*>)?([^<]*)/g)]
  .map(x=>x[2].trim()+'  ->  '+x[1]).filter(x=>!x.startsWith('  ->'));
console.log(items.length?items.join('\n'):'(サイドバーが空)');
" dist/<最初の記事>/index.html

# Mermaid が図に変換されているかを確認する（mermaid ブロックがある場合）
# ソースのブロック数と dist の .mermaid コンテナ数が一致すべき。
# 数が合わない、または 0 なら mermaid() の位置が starlight() より後ろになっている。
echo "ソース: $(grep -rc '^```mermaid' src/content/docs/ | awk -F: '{s+=$2} END {print s}')"
echo "dist  : $(grep -rho 'class="mermaid"' dist/ | wc -l | tr -d ' ')"

# 生テキストのまま残っていないかを確認する（0件であるべき）
grep -rhoE '<code[^>]*>(graph|flowchart|sequenceDiagram|gantt|classDiagram|erDiagram|stateDiagram)' dist/ | sort | uniq -c
```

> 画像が `_astro/` に想定より少なく出力される場合、**内容が同一の画像は 1 ファイルに重複排除される**ためであり異常ではない。md 側の参照先が正しいかで判断する。

### ステップ 7: GitHub Pages の設定とブランチ運用

#### 7-a. Pages の公開元を切り替える

リポジトリの **Settings → Pages → Source** を **「GitHub Actions」** に変更する。「Deploy from a branch」のままだと Jekyll が動いてしまう。

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow 2>/dev/null \
  || gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

#### 7-b. ビルド成果物は Git 管理しない

`dist/` は `.gitignore` に入れ、**リポジトリには絶対にコミットしない**。

- ソースから再生成できるため保存する価値がない
- ファイル名にハッシュが入る（`vs-install.my-bkdm6_Z1HglpU.webp`）ため、複数人が触ると必ず衝突しマージ不能になる
- PR の差分が生成物で埋まりレビューできなくなる

現行の `actions/deploy-pages@v4` は artifact を Pages へ直接渡すため、**`gh-pages` ブランチも作られない**。ネット記事に出てくる `peaceiris/actions-gh-pages` や「gh-pages ブランチに push」は旧方式なので混同しないこと。

ローカルの `npm run build` は自分が確認するためだけの行為で、結果は捨ててよい。公開されるのは常に CI が main から作り直したもの。

#### 7-c. 2つのワークフローを使い分ける

| ファイル | 契機 | やること | デプロイ |
| --- | --- | --- | --- |
| `feature-build-only.yml` | feature への push / PR | ビルド検証 + artifact 出力 | しない |
| `main-build-and-publish.yml` | main への push（マージ含む） | ビルドして Pages へ公開 | する |

**ビルドは feature 側と main 側で 2 回走る。これは冗長ではなく必要。** feature でのビルド時点と、マージ後の main のツリーは別物になりうる（他の PR が先にマージされている、コンフリクト解決の結果が含まれる）。公開物の出所を main に一本化するため、feature の artifact は公開に使わない。

`feature-build-only.yml` は `push` と `pull_request` の両方を拾う。両者は同一コミットで同時に発火するが、`concurrency` の `cancel-in-progress: true` により重複分は即キャンセルされ、実質 1 回分の実行に収まる。

- `push`（`branches-ignore: [main]`）… PR を出す前から検証できる
- `pull_request`（`branches: [main]`）… **main とマージした結果**を検証できる。main が先に進んでいる場合の破損を検知する

#### 7-d. 既存の Git リポジトリへ適用する場合

既に `main` があるので、作業はすべて feature ブランチで行い PR にまとめる。

```bash
git switch -c feature/astro-starlight
# ここで導入・再構成・md 修正をすべて行う
git push -u origin feature/astro-starlight
gh pr create --fill
```

**注意点**

- **ファイル移動は必ず `git mv` を使う。** 単なる `mv` だと「削除 + 新規追加」として記録され、PR の差分が全ファイル書き換えに見えてレビュー不能になる。
- **PR が巨大になる**（移動 + 設定追加 + md 修正）。レビューしやすくするなら「①ファイル移動だけのコミット」「②設定追加のコミット」「③md 修正のコミット」に分け、コミット単位で追えるようにする。
- **既存の `.github/workflows/`、`package.json`、`.gitignore` がある場合は上書きせず統合する。** テンプレートをそのままコピーすると既存の CI を破壊する。
- 空のリポジトリに新規適用する場合のみ、最初の 1 コミットは分岐元が無いため main に直接置くことになる。


## 画像の置き場所

判断基準は「置き場所」ではなく **「URL が変わって困るか」**。

| 置き場所 | 対象 | 挙動 |
| --- | --- | --- |
| `images/`（リポジトリ直下） | md 本文の画像・図・スクショ | 相対参照で最適化（WebP 変換・`width`/`height`/`loading` 自動付与）、`base` 自動付与 |
| `public/` | favicon, CNAME, robots.txt, OGP 画像, `.nojekyll` | 無加工でコピー。URL 固定。**最適化されない** |

`public/` の画像を相対参照すると最適化版も生成され、**同じ画像が dist に二重出力**される。本文画像を `public/` に置く理由はない。

既存リポジトリの `images/` は**移動不要**。相対パスで参照すれば動き、GitHub 上で md を直接見たときも画像が表示される利点がある。

## つまずきポイント

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| CSS が当たらない、全リンク 404 | `base` 未設定 | `astro.config.mjs` に `base` を設定 |
| 画像だけ 404 | md が絶対パス参照 | 相対パスに変更 |
| md リンクが 404（`.md` が URL に残る） | Astro/Starlight に変換機能が無い | `rehype-markdown-links.mjs` を導入 |
| 見出しが二重表示 | `title` と本文 `# h1` の重複 | 本文の h1 を削除 |
| `sidebar` でビルドエラー | v0.39 で `autogenerate` の書式変更 | `{ label, items: [{ autogenerate: {...} }] }` 形式にする |
| `markdown.rehypePlugins` が非推奨警告 | Astro v7 で仕様変更 | `markdown.processor: unified({ rehypePlugins: [...] })` を使う |
| `_astro/` 配下が配信されない | Jekyll が `_` 始まりを無視 | `public/.nojekyll` を置く |
| `title` 必須エラー | frontmatter 欠落 | 全 md に `title` を追加 |
| ローカルは通るのに CI だけ失敗する | ワークフローの Node が古い（Astro 7 は **Node 22.12 以上**が必須） | `setup-node` の `node-version` を 22 にする。`node_modules/astro/package.json` の `engines` で必要版を確認できる |
| `/favicon.svg` が 404 | Starlight は既定で `/favicon.svg` を参照するがファイルは同梱されない | `public/favicon.svg` を置く、または `starlight({ favicon: '/xxx.svg' })` で指定 |
| ページ順が意図通りにならない | 自動サイドバーは **slug 順**で並ぶ（`title` は無関係） | フォルダ名に `01-` などの連番を付ける |
| 再構成後にリンクだけ静かに壊れる | md の移動で相対位置がずれてもビルドは成功する | ステップ 6 の「内部リンク切れ検出」を必ず実行する |
| 未使用画像が `src/content/docs/images/` に残る | 振り分け先が無い画像の置き場所を決めずに作業した | コンテンツ配下はページ用。`images-unused/` などリポジトリ直下へ退避する（ビルドには出ないが紛らわしい） |
| README を置いたのにサイトに出ない | `README.md` はビルド対象外（Astro が読むのは `src/content/docs/` 配下だけ） | トップページにするなら `src/content/docs/index.md` として内容をコピーする（ステップ 5-b） |
| サイドバーに記事が出ない（ビルドは成功する） | `sidebar` の `autogenerate` が存在しないディレクトリを指しており、黙って消えている | `sidebar` の設定自体を削除して自動生成に任せる。明示指定するなら実在パスを書き、ステップ 6 のサイドバー確認コマンドで実物を数える |
| サイドバーの並び順が意図と違う | 並び順は slug（フォルダ名）順で決まる。frontmatter の `title` は無関係 | フォルダ名に `01-`, `02-` の連番を付ける |
| Mermaid が `flowchart TD` などの生テキストで表示される | Starlight は Mermaid 未対応 | `astro-mermaid` を導入する（ステップ 3・4） |
| `astro-mermaid` を入れたのに図にならない | `integrations` で `mermaid()` が `starlight()` より**後ろ**にある。エラーは出ない | `mermaid()` を配列の先頭に移す |
| `Cannot find package 'astro-mermaid'` | テンプレートの `mermaid()` を残したまま依存を入れていない | 入れるか、`import` ごと削除する |

## 情報の鮮度に関する注意

Astro と Starlight は破壊的変更が多い。**ネット上の記事や既存の知識は古い可能性が高い。**

- `sidebar` の `autogenerate` 書式は Starlight v0.39 で変更された
- `markdown.rehypePlugins` は Astro v7 で非推奨になった

**判断に迷ったら `node_modules/` 内の型定義（`.d.ts`）とソースを直接読む。** これが最も確実な一次情報である。エラーメッセージも修正後のコードを提示してくれることが多いので、まずエラー全文を読む。

## 作業を進める上での原則

- 実装前に必ずステップ 1 の調査を行い、作業量をユーザーに提示する
- ステップ 2 の配置方針はユーザーに確認する
- 各ステップ完了後にビルドを通し、壊れていないことを確認してから次へ進む
