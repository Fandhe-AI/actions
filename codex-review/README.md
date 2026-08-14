# codex-review

OpenAI Codex CLI による PR 自動レビューの reusable workflow。PR の差分を Codex がレビューし、
優先度付きの指摘（P0〜P3）を **PR レビュー（総括 + 該当行へのインラインコメント）**として
投稿、ブロック対象 priority（`block-priorities` 入力でリポジトリごとに調整可能。既定 P0/P1）の
検出時は CI ジョブを失敗させる。指摘は差分から見つかったものを 1 回のレビューで全件列挙する。
行を特定できない指摘（`path`/`line` 欠落・diff 外の行）はレビュー body 側の一覧に載り、
レビュー投稿自体に失敗した場合は従来形式の単一 issue コメントへフォールバックする。
レビュー投稿の前後では、PR に残っている未解決レビュースレッドの後片付けも行う:
(1) 過去の実行が投稿した未解決インラインスレッド（識別マーカー
`<!-- codex-review-finding -->` 付き）は、陳腐化済みとして無条件に自動 resolve する
（レビューは毎回、現時点の指摘を全件投稿し直すため。解消していない指摘は新しい
スレッドとして再投稿される）。(2) それ以外の未解決スレッド（他レビュアー・マーカー
導入前の旧コメント等）は、一覧を prompt に付加して Codex がレビュー時に現在の HEAD で
対応済みかをコードで再判定し、**対応済みと確認できたものだけ**を resolve する
（出力 `resolved_threads`。判定不能・未対応は残す fail-closed）。いずれも、レビュー未完遂
`review_completed != true` の場合と、resolve 直前の確認で PR の head が進んでいた場合
＝より新しい実行に委ねるべき場合は、fail-closed で resolve しない。

- 認証は **codex-home 方式**: OpenAI API キーは使わず、self-hosted runner 上に用意した
  ChatGPT ログイン済みの `CODEX_HOME` ディレクトリを参照する（ChatGPT プランのレート枠で動作）
- 出力は JSON スキーマで構造化し、**2 段の fail-closed gate**（レビュー完遂判定
  `review_completed` → ブロック対象 priority 判定）で判定する
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
3. 導入先リポジトリが codex 専用 runner の **runner group から利用を許可**されていること
   （org 運用時。未許可だとジョブが runner 待ちのまま進まない）
4. `gh` 等の追加ツールは不要（`actions/github-script` でコメント投稿する）

## セットアップ

新規リポジトリへ展開する際は、以下を上から順に実施する。

### 1. codex 専用 runner を利用可能にする

runner 本体が未構築なら「runner 構築」章に従って用意する。構築済みの場合でも、
runner group に**導入先リポジトリを追加**しないとジョブが runner を掴めず待ち続ける。

```bash
# 対象 runner group を確認する
gh api orgs/Fandhe-AI/actions/runner-groups --jq '.runner_groups[] | {id, name, visibility}'

# runner group へ導入先リポジトリを追加する
gh api -X PUT "orgs/Fandhe-AI/actions/runner-groups/<GROUP_ID>/repositories/<REPO_ID>"
# <REPO_ID> は gh api repos/Fandhe-AI/<repo> --jq '.id' で取得する
```

runner group は**信頼できるリポジトリのみ**に開放する（「注意事項」参照）。

### 2. Actions variable `CODEX_HOME_DIR` を設定する（有効化スイッチ）

runner 上の `CODEX_HOME` マウント先パス（例: `/opt/codex-home`）を Actions variable
`CODEX_HOME_DIR` に設定する。**未設定の間は codex ジョブが skip される**
（fail-closed。設定が唯一の有効化操作）。

```bash
# リポジトリ単位で設定する場合
gh variable set CODEX_HOME_DIR --repo Fandhe-AI/<repo> --body /opt/codex-home

# org 単位で、許可したリポジトリにだけ見せる場合
gh variable set CODEX_HOME_DIR --org Fandhe-AI --body /opt/codex-home \
  --visibility selected --repos <repo1>,<repo2>

# 確認（値が空でないこと）
gh variable list --repo Fandhe-AI/<repo>
```

### 3. wrapper ワークフローをコピーする

`codex-review/templates/` の wrapper テンプレートを、導入先リポジトリの
`.github/workflows/codex-review.yml` としてコピーする。**リポジトリの可視性で選ぶ**:

| 導入先の可視性 | コピーするテンプレート | 理由 |
|---|---|---|
| private | [`templates/codex-review.private.yml`](templates/codex-review.private.yml) | runner 既定値（`codex` / `self-hosted`）が組織 runner 方針に合致する |
| public | [`templates/codex-review.public.yml`](templates/codex-review.public.yml) | `post-feedback-runner-label` の既定値 `self-hosted` が方針に反するため `ubuntu-latest` を明示する |

```bash
# 導入先リポジトリのルートで実行（private の場合。public は .public.yml に読み替える）
mkdir -p .github/workflows
gh api -H 'Accept: application/vnd.github.raw' \
  repos/Fandhe-AI/actions/contents/codex-review/templates/codex-review.private.yml \
  > .github/workflows/codex-review.yml
```

本リポジトリのローカルチェックアウトがあれば `cp` でも同じ結果になる。
runner 選択の根拠は [`docs/runner-policy.md`](../docs/runner-policy.md) を参照。

### 4. `<SHA>` を固定する

テンプレートの `uses:` は `@<SHA>` のままなので、本リポジトリのコミット SHA へ置換する
（`@main` 不可）:

```bash
SHA="$(gh api repos/Fandhe-AI/actions/commits/main --jq '.sha')"
perl -pi -e "s/\@<SHA>/\@${SHA}/" .github/workflows/codex-review.yml
```

置換後、`uses:` 行に 40 桁の SHA が入っていることを目視確認してからコミットする。

### 5. 動作確認（skip されていないことの確認）

codex ジョブは `CODEX_HOME_DIR` 未設定時と fork からの PR で **skip** される。
**skip されたジョブはワークフロー全体では成功扱いに見える**ため、初回導入時は必ず
ジョブ単位で実行結果を確認する。

```bash
# 導入先リポジトリで PR を 1 本作ったうえで実行する
gh run list --repo Fandhe-AI/<repo> --workflow "Codex PR review" --limit 1
gh run view <run-id> --repo Fandhe-AI/<repo> --json jobs \
  --jq '.jobs[] | {name, status, conclusion}'
```

`codex` ジョブの `conclusion` が `skipped` でなく、PR に「Codex PR レビュー」の
PR レビュー（またはフォールバック時の issue コメント）が投稿されていれば導入完了。
`skipped` の場合は「注意事項」のトラブルシューティングを参照。

### 6. レビュー基準のカスタマイズ（任意）

何も置かなければ同梱既定版（`codex-review/prompts/review.md` の汎用レビュー基準）で動く。
リポジトリ固有の基準を使う場合は、以下を base ブランチへコミットする:

| ファイル | 役割 |
|---|---|
| `AGENTS.md` | リポジトリ固有の規約・レビュー基準。存在すれば prompt がベースブランチ側の内容を必ず読む |
| `.github/codex/prompts/review.md` | レビュー指示文そのもの（同梱既定版を差し替える。既定版を出発点にコピーして編集するとよい） |
| `.github/codex/review-schema.json` | 出力スキーマ（`summary` / `findings` / `review_completed` は gate・コメント描画が消費するため必須のまま維持する。`resolved_threads` が無いカスタム版では未解決スレッドの対応済み再判定が無効になる（他の動作には後方互換）。finding の `path` / `line` はインラインコメントのアンカーに使い、欠落時は `location` の `file:line` パースへフォールバックする） |

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
| `block-priorities` | - | `P0,P1` | ジョブを失敗させる指摘の priority（カンマ区切り。例 `P0,P1,P2`）。P0/P1 は必須集合（gate の弱体化防止のため除外不可）で、調整できるのは P2/P3 の追加のみ。含まれない P2/P3 は advisory（コメント投稿のみ）。P0/P1 を欠く指定・空・P0〜P3 以外は fail-closed で拒否 |

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

`inputs` の追加・既定値変更が入った場合は `codex-review/templates/` の wrapper
テンプレートも更新されるため、SHA 更新時にテンプレートとの差分も確認する。

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
- gate（ブロック対象 priority でジョブ失敗。既定 P0/P1、`block-priorities` で調整）を
  required status check にするかは呼び出し側の branch
  protection 設定次第。`CODEX_HOME_DIR` 未設定時はジョブが skip されるため、required 化
  する場合は skip との両立（skip を成功扱いにするか等）を呼び出し側で設計すること
- レビューはセキュリティ境界ではない。最終判断は人間レビューが担う

### トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| codex ジョブが `skipped`（PR コメントも出ない） | `CODEX_HOME_DIR` 未設定、または fork からの PR | セットアップ 2 で variable を設定する。fork PR は仕様上実行しない |
| ジョブが `Waiting for a runner` のまま進まない | 導入先リポジトリが runner group に未追加、または `runner-label` に一致する runner が無い | セットアップ 1 で runner group へ追加する。ラベルは `runner-label` の値（既定 `codex`）と一致させる |
| `sudo -n true` の fail-closed 検証で失敗する | ジョブ実行ユーザーが passwordless sudo を持っている | runner のジョブユーザーを sudoers から外す（「runner 構築」参照） |
| `bwrap: No permissions to create a new namespace` | unprivileged user namespace が禁止されている | seccomp / AppArmor プロファイルで userns 作成を許可する（「runner 構築」参照） |
| `@openai/codex` のインストールに失敗する | runner から `registry.npmjs.org` へ到達できない | runner のネットワーク・プロキシ設定を確認する |
| 認証エラーでレビューが失敗する | `CODEX_HOME` の refresh token 失効、または `auth.json` が read-only マウント | ホストで `codex login --device-auth` を再実行し、read-write マウントであることを確認する |
| `review_completed != true` の gate 失敗（summary に `Read-only file system` への言及） | read-only sandbox 下でモデルがファイルへのリダイレクト等の書き込みを試みた（sandbox の正常動作。イシュー #49 で同梱既定 prompt に書き込み禁止の明示と組み替え続行の指示を追加済み） | wrapper の `uses: ...@<SHA>` を対策込みの SHA へ追随する。カスタム prompt 利用時は同等の「実行環境の制約」節を自前の prompt へ反映する |
| public リポジトリでコメント投稿ジョブが runner 待ちになる | `post-feedback-runner-label` が既定値 `self-hosted` のまま | public 用テンプレートを使い `ubuntu-latest` を渡す |
