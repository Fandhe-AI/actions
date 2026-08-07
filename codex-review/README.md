# codex-review

OpenAI Codex CLI による PR 自動レビューの reusable workflow。PR の差分を Codex がレビューし、
優先度付きの指摘（P0〜P3）を PR コメントへ投稿、P0/P1 検出時は CI ジョブを失敗させる。

- 認証は **codex-home 方式**: OpenAI API キーは使わず、self-hosted runner 上に用意した
  ChatGPT ログイン済みの `CODEX_HOME` ディレクトリを参照する（ChatGPT プランのレート枠で動作）
- 出力は JSON スキーマで構造化し、**2 段の fail-closed gate**（レビュー完遂判定
  `review_completed` → P0/P1 判定）で判定する
- レビュー基準・プロンプトはリポジトリごとにカスタマイズ可能。無ければ同梱既定版で動く
- プロンプトインジェクション・symlink 脱出・資格情報漏洩への多層防御を内蔵する
  （設計根拠は `.github/workflows/codex-review.yml` のコメントを参照）

## 前提条件

1. **self-hosted runner（codex 専用プール）**が構築済みであること（後述の「runner 構築」参照）。
   要件:
   - ジョブ実行ユーザーが **sudo を使えない**（workflow が `sudo -n true` を fail-closed 検証する）
   - コンテナランナーの場合、**unprivileged user namespace の作成が許可**されている
     （Codex の read-only sandbox が bubblewrap を使うため。禁止環境では
     `bwrap: No permissions to create a new namespace` で必ず失敗する）
   - ChatGPT ログイン済み `CODEX_HOME` ディレクトリが read-write でマウント済み
   - 専用の用途ラベル（既定: `codex`）で登録済み。レビュー以外のジョブと混ぜない
2. runner からレジストリ `registry.npmjs.org` への外向き通信が可能であること
   （workflow がジョブ内で `@openai/codex` をバージョン固定インストールする。
   runner イメージへの codex / Node.js の常設インストールは不要）
3. `gh` 等の追加ツールは不要（`actions/github-script` でコメント投稿する）

## セットアップ

### 1. Actions variable の設定（有効化スイッチ）

org または リポジトリの Actions variable `CODEX_HOME_DIR` に、runner 上の
`CODEX_HOME` マウント先パス（例: `/opt/codex-home`）を設定する。
**未設定の間は全ジョブが skip される**（fail-closed。設定が唯一の有効化操作）。

### 2. wrapper ワークフローの設置

呼び出し側リポジトリに `.github/workflows/codex-review.yml` を作成する:

```yaml
name: Codex PR review

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

# reusable workflow のトップレベル concurrency は機能しないため呼び出し側で設定する
concurrency:
  group: codex-review-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  codex-review:
    uses: Fandhe-AI/actions/.github/workflows/codex-review.yml@<SHA> # main
    permissions:
      contents: read
      pull-requests: write
```

`<SHA>` は本リポジトリのコミット SHA で固定する（`@main` 不可。SHA の更新方法は後述）。

### 3. レビュー基準のカスタマイズ（任意）

何も置かなければ同梱既定版（`codex-review/prompts/review.md` の汎用レビュー基準）で動く。
リポジトリ固有の基準を使う場合は、以下を base ブランチへコミットする:

| ファイル | 役割 |
|---|---|
| `AGENTS.md` | リポジトリ固有の規約・レビュー基準。存在すれば prompt がベースブランチ側の内容を必ず読む |
| `.github/codex/prompts/review.md` | レビュー指示文そのもの（同梱既定版を差し替える。既定版を出発点にコピーして編集するとよい） |
| `.github/codex/review-schema.json` | 出力スキーマ（`summary` / `findings` / `review_completed` は gate・コメント描画が消費するため必須のまま維持する） |

制御ファイルは PR の checkout からではなく **PR の base コミット**から読まれるため、
PR 自身がレビュー基準を書き換えても当の PR のレビューには反映されない（マージ後の PR から反映）。

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `runner-label` | - | `codex` | codex ジョブを実行する runner ラベル。`CODEX_HOME` マウント済み専用プールを用途ラベルで指す |
| `post-feedback-runner-label` | - | `self-hosted` | PR コメント投稿ジョブ（資格情報に触れない）の runner ラベル |
| `codex-version` | - | `0.146.1` | `@openai/codex` の固定バージョン（latest 不可） |
| `timeout-minutes` | - | `30` | codex ジョブの timeout（分） |
| `prompt-path` | - | `.github/codex/prompts/review.md` | 呼び出し側リポジトリの prompt パス（base に無ければ同梱既定版） |
| `schema-path` | - | `.github/codex/review-schema.json` | 呼び出し側リポジトリの schema パス（base に無ければ同梱既定版） |

## runner 構築

コンテナ型 self-hosted runner（GitHub Actions Runner を Docker コンテナで常駐させる構成）を
前提とした設定例。ホストへ直接インストールする構成でも要件（sudo なし・userns・CODEX_HOME）は同じ。

### 1. ホスト側で CODEX_HOME を用意する

```bash
sudo mkdir -p /opt/codex-home
sudo chown <runner-job-uid>:<runner-job-gid> /opt/codex-home
chmod 700 /opt/codex-home

# ChatGPT アカウントでデバイス認証ログイン（codex CLI は一時導入でよい）
CODEX_HOME=/opt/codex-home codex login --device-auth
chmod 600 /opt/codex-home/auth.json

# 確認: "Logged in using ChatGPT" が出れば OK
CODEX_HOME=/opt/codex-home codex login status
```

### 2. docker compose の設定例

```yaml
services:
  gha-runner-codex:
    image: your-runner-image # actions/runner ベースの自作イメージ等
    environment:
      RUNNER_LABELS: codex # 用途ラベル。既定ラベル（self-hosted 等）は無効化を推奨
      # 既定ラベルの無効化はランナー登録方法に依存（例: config.sh --no-default-labels）
    volumes:
      # auth.json は CLI の refresh で書き換わるため read-write でマウントする
      - /opt/codex-home:/opt/codex-home
    security_opt:
      # Codex の read-only sandbox（bubblewrap）が unprivileged user namespace を
      # 必要とする。既定の seccomp プロファイルはこれを禁止するため、userns 関連
      # syscall（clone の CLONE_NEWUSER・unshare 等）を許可したカスタムプロファイルを
      # 適用する（最終手段としては unconfined だが、可能な限りプロファイルで絞る）
      - seccomp=./seccomp-userns.json
      # AppArmor 有効なホストではプロファイル側でも userns 作成を許可する
      # （Ubuntu 24.04+ の restrict_unprivileged_userns 有効環境等）
      # - apparmor=<your-profile>
```

コンテナ内のジョブ実行ユーザーは非 root・sudo 未導入（または sudoers 非登録）とする。
`docker.sock` はマウントしない。

### 3. 動作確認

```bash
# コンテナ内のジョブ実行ユーザーで:
sudo -n true                          # → 失敗すること（sudo なし）
bwrap --unshare-all --ro-bind / / true # → 成功すること（userns 許可）
```

## SHA の更新方法

```bash
# 最新の main の SHA を確認
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'
```

wrapper の `uses: Fandhe-AI/actions/.github/workflows/codex-review.yml@<SHA>` を更新する。
同梱既定 prompt / schema は wrapper が固定した SHA と同一コミットから読まれるため、
SHA 更新で workflow 本体と既定制御ファイルが常に一緒に切り替わる。

## 注意事項

- **auth.json はパスワード同等**。コミット・ログ・チケットへ貼らない。トークン値は
  マスク・スキャン機構の対象だが、機構に頼らず取り扱わないこと
- **信頼できないリポジトリへ codex ランナーを共有しない**。fork からの PR では
  workflow 側が実行を拒否するが、ランナープールの開放範囲（runner group）も
  信頼できるリポジトリに限定する
- Codex レビューの実行は **ChatGPT プランのレート枠を消費**する。有効化するリポジトリの
  PR 頻度に注意する
- refresh token が失効するとレビューが失敗する。その場合はホスト側で
  `codex login --device-auth` を再実行する
- gate（P0/P1 でジョブ失敗）を required status check にするかは呼び出し側の branch
  protection 設定次第。`CODEX_HOME_DIR` 未設定時はジョブが skip されるため、required 化
  する場合は skip との両立（skip を成功扱いにするか等）を呼び出し側で設計すること
- レビューはセキュリティ境界ではない。最終判断は人間レビューが担う
