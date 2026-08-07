# pages-deploy

GitHub Pages への deploy を共通化する reusable workflow。呼び出し側リポジトリの build ジョブが
生成したサイト成果物（dist）を artifact で受け取り、Pages 専用 artifact への変換
（`actions/upload-pages-artifact`）から `actions/deploy-pages` によるデプロイまでを担う。

- build ジョブは**呼び出し側に残す**設計: サイト生成は言語・SSG（Rust 製 SSG / Next.js 等）に
  依存しリポジトリごとに異なるため共通化しない。共通化するのは Pages 固有の deploy 部分のみ
- `permissions`（`pages: write` / `id-token: write`）・`environment: github-pages` は
  共通側でジョブレベル最小定義する
- 使用する外部 action はすべてコミット SHA 固定
- 空サイト・パス不正を黙って公開しない fail-closed 検証を内蔵する

### 設計判断: artifact 連携方式

reusable workflow のジョブは呼び出し側ジョブと**ファイルシステムを共有しない**ため、dist の
受け渡しは artifact 経由が唯一の手段になる。候補は 2 案あり、本 workflow は案 B を採る。

| 案 | 呼び出し側の手数 | 評価 |
|---|---|---|
| A: 呼び出し側が `actions/upload-pages-artifact` を直接実行し、共通側は `deploy-pages` のみ | upload 1 ステップ | Pages 専用 action の SHA 固定・バージョン追随義務が全呼び出し側リポジトリに残り、共通化の利得が薄い |
| B（採用）: 呼び出し側は**汎用** `actions/upload-artifact` で dist を渡し、共通側が download → `upload-pages-artifact` → `deploy-pages` まで担う | upload 1 ステップ | 呼び出し側の手数は案 A と同じまま、Pages 固有の知識（専用 artifact 形式・action 群・permissions/environment 定義）とその SHA 固定運用を共通側 1 箇所へ集約できる |

呼び出し側のステップ数はどちらも 1 のため、「Pages の仕様・action バージョンの変更に呼び出し側が
追随不要になる」案 B が呼び出し側の実質的な手数最小になる。

## 前提条件

1. **呼び出し側リポジトリで GitHub Pages の Source が "GitHub Actions" に設定済み**であること
   （Settings → Pages → Source。未設定の場合 deploy ジョブのみが失敗する）。CLI で有効化する場合:

   ```bash
   gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
   ```

2. self-hosted runner が利用可能であること（fandhe 系リポジトリは self-hosted 前提。
   `runner-label` 入力で専用プールも指定可能）
3. runner に `tar` がインストール済みであること（`actions/upload-pages-artifact` が内部で使用。
   Linux self-hosted プールでは通常常設）

## セットアップ

呼び出し側リポジトリの workflow に build ジョブ（既存のサイト生成処理 + 汎用 artifact の
upload）と、本 workflow を呼ぶ deploy ジョブを置く:

```yaml
name: docs-site

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

# reusable workflow のトップレベル concurrency は機能しないため呼び出し側で設定する。
# Pages はデプロイ中断で中途半端な公開状態になりうるため cancel-in-progress: false を推奨
concurrency:
  group: docs-site-pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: self-hosted
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v5

      # リポジトリ固有のサイト生成（例: Rust 製 SSG）。dist の実在検証等の
      # sanity check もここで行うとよい
      - name: Build site
        run: cargo run -p my-docs-site -- --out "${RUNNER_TEMP}/dist"

      # dist を汎用 artifact として渡す（Pages 専用 action は共通側が実行する）
      - name: Upload dist
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: pages-dist
          path: ${{ runner.temp }}/dist
          if-no-files-found: error

  deploy:
    needs: build
    # reusable workflow は呼び出し側が付与した以上の権限を持てないため、
    # 共通側ジョブが必要とする 2 権限をここでも付与する
    permissions:
      pages: write
      id-token: write
    uses: Fandhe-AI/actions/.github/workflows/pages-deploy.yml@<SHA> # main
    with:
      # upload-artifact は path 直下の内容を artifact ルートへ置くため、
      # 上記のように dist ディレクトリ自体を path に指定した場合は "." を指定する
      dist-dir: "."
```

`<SHA>` は本リポジトリのコミット SHA で固定する（`@main` 不可。SHA の更新方法は後述）。

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `dist-dir` | ○ | - | ダウンロードした artifact 内での公開ルートへの相対パス。artifact のルートがそのまま公開ルートなら `"."`。絶対パス・`..`/`.` セグメントは fail-closed で拒否 |
| `artifact-name` | - | `pages-dist` | 呼び出し側 build ジョブが `actions/upload-artifact` でアップロードした artifact 名 |
| `runner-label` | - | `self-hosted` | deploy ジョブを実行する runner ラベル |
| `timeout-minutes` | - | `10` | deploy ジョブの timeout（分） |

## SHA の更新方法

```bash
# 最新の main の SHA を確認
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'
```

呼び出し側 wrapper の `uses: Fandhe-AI/actions/.github/workflows/pages-deploy.yml@<SHA>` を更新する。

本 workflow が内部で使う外部 action（`download-artifact` / `upload-pages-artifact` /
`deploy-pages`）の SHA を更新する場合は、タグの実コミット SHA を API で解決して使う
（値をでっち上げない）:

```bash
# 例: actions/deploy-pages の v5.0.0 タグのコミット SHA を解決
gh api repos/actions/deploy-pages/git/ref/tags/v5.0.0 --jq '.object'
# .object.type が "tag"（annotated tag）の場合はもう 1 段 dereference する
gh api repos/actions/deploy-pages/git/tags/<tag-object-sha> --jq '.object.sha'
```

## 注意事項

- **`concurrency` は呼び出し側で設定する**（reusable workflow のトップレベル concurrency は
  機能しない）。Pages のデプロイ中断は中途半端な公開状態を招くため
  `cancel-in-progress: false` を推奨
- **呼び出し側の `uses:` ジョブに `pages: write` / `id-token: write` の付与が必須**。
  reusable workflow 側の permissions 定義は呼び出し側が付与した権限を絞る方向にしか働かない
- `actions/upload-artifact` は path 直下の内容を artifact ルートへ置く（共通の親ディレクトリを
  strip する）。`dist-dir` は「artifact 内の」相対パスであり、runner 上のパスではない
- 同一 run 内で artifact 名が衝突しないよう、build ジョブを複数持つ場合は `artifact-name` を
  ジョブごとに変える
- Pages の Source 未設定・environment `github-pages` の保護ルール（deployment branch
  制限等）による失敗は本 workflow では検知・回避できない。呼び出し側リポジトリの設定を確認する
