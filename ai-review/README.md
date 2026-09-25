# ai-review

複数の AI（OpenAI Codex / Anthropic Claude / Google Gemini / xAI Grok / OpenAI 互換 API の
local LLM 等）で PR を自動レビューする reusable workflow。`codex-review`（Codex 専用。互換の
ため凍結して残置）を provider 非依存に一般化したもの。PR の差分を AI がレビューし、優先度付き
の指摘（P0〜P3）を **PR レビュー（総括 + 該当行へのインラインコメント）**として投稿、ブロック
対象 priority（既定 P0/P1）の検出時は CI ジョブを失敗させる。複数モデルを並列に走らせて
見落としを相互補完する「複数モデルでの同時レビュー」にも対応する。workflow 本体は
[`.github/workflows/ai-review.yml`](../.github/workflows/ai-review.yml)。

## 概要

provider は 2 方式に分かれる。

| provider | 方式 | 実行 | 読み取り専用の担保 | schema 強制 | 既定 runner | 既定 model | 認証 |
|---|---|---|---|---|---|---|---|
| `codex` | agentic | CLI 0.157.0 | `codex exec --sandbox read-only`（bubblewrap） | `--output-schema` | `codex`（用途ラベル） | `gpt-6-sol`（effort `low`） | home-dir（`CODEX_HOME`、変数 `CODEX_HOME_DIR`）または API_KEY（OpenAI、`CODEX_API_KEY` として渡す） |
| `claude` | agentic | CLI 2.1.280 | `claude -p --restricted --safe-mode --tools Read,Grep,Glob --permission-mode dontAsk` | `--json-schema` | `claude`（用途ラベル） | `claude-sonnet-5` | home-dir（`CLAUDE_CONFIG_DIR`、変数 `CLAUDE_HOME_DIR`）または API_KEY（Anthropic API キー → `ANTHROPIC_API_KEY`、`claude setup-token` の OAuth トークン `sk-ant-oat…` → `CLAUDE_CODE_OAUTH_TOKEN`） |
| `gemini` | agentic | CLI 0.60.0 | `gemini -p -o json --approval-mode plan --admin-policy`（読み取り系ツール以外を全拒否。Web 検索・取得も拒否） | 非対応。指示文 + `normalize-output.mjs` で検証 | `gemini`（用途ラベル） | CLI 既定（自動ルーティング） | home-dir（`GEMINI_CLI_HOME`、変数 `GEMINI_HOME_DIR`）または API_KEY（`GEMINI_API_KEY`） |
| `grok` | api | xAI API（OpenAI 互換 `https://api.x.ai/v1`） | ツール自体を渡さない | `response_format: json_schema`（strict） | private: self-hosted / public: `ubuntu-latest` | 必須（`model` 入力） | API_KEY 必須（xAI API キー） |
| `openai-compatible` | api | vLLM / SGLang 等の local LLM、Gemini の OpenAI 互換 endpoint 等 | ツール自体を渡さない | `api-response-format`（json_schema/json_object/none） | private: self-hosted / public: `ubuntu-latest` | 必須（`model` 入力） | `api-base-url`（Actions variable `AI_REVIEW_API_BASE_URLS` の許可リストと完全一致）+ `model` 必須、API_KEY 任意 |

`gemini` は `reasoning-effort` 非対応。API provider（`grok` / `openai-compatible`）は
`max-diff-bytes` 超過時に API を呼ばず fail-closed で未完了扱いにする（部分レビューを完了扱いに
しない）。`openai-compatible` で `auth: api-key` を明示した場合は secret `API_KEY` を必須とする
（未設定なら skip。無認証送信へ黙って倒さない）。

## 仕組み

ジョブ構成は `preflight → review → post_feedback` の 3 段。

- **preflight**: 入力検証・既定値解決・有効化判定（資格情報の有無）・skip 判定を行う。
  資格情報の値には触れず「設定の有無」だけを見る。fork PR では起動しない
- **review**: PR head を checkout し、prompt / schema / スクリプトを本リポジトリの
  同梱既定版から取得、制御ファイルを base コミットから抽出、CLI/API を実行、
  `normalize-output.mjs` で契約を検証・正規化する
- **post_feedback**: 正規化済み結果を PR レビューとして投稿する（資格情報に触れない
  読み取り専用の review ジョブとは別ジョブに分離し、`pull-requests: write` はここだけが持つ）

**2 段 fail-closed gate**: (1) `review_completed === true` でなければジョブ失敗（レビュー
手順自体が完遂したか）、(2) ブロック対象 priority（既定 P0/P1、P0/P1 は除外不可）の指摘が
1 件でもあればジョブ失敗。出力は `normalize-output.mjs` が契約（`summary` / `review_completed`
/ `findings` / `resolved_threads`）を検証し、適合しない出力は「未完了」の合成結果へ置き換える
（モデル出力の断片を未検証のまま PR コメントへ流さない）。

**結果の受け渡しと投稿量**: 正規化済み結果は資格情報スキャン後に artifact（保持 1 日）で
`post_feedback` へ渡す。総括・行を特定できない指摘の一覧は GitHub の本文上限（65,536 文字）
に収まるよう分割し、2 件目以降は issue コメント（`（続き）`）として投稿する。

**インライン指摘の自動 resolve**: 投稿する各 finding には reviewer-id ごとのマーカー
`<!-- ai-review-finding reviewer=<id> -->` を付ける。新しいレビュー投稿の前後で:

- 自分（同じ `reviewer-id`）の旧指摘スレッドは無条件に resolve する（今回のレビューが
  現時点の指摘を全件投稿し直すため。未解消の指摘は新しいスレッドとして再投稿される）
- 他の AI reviewer のスレッドには一切触れない（複数モデル同時レビューで互いの指摘を
  閉じ合わない。`codex` reviewer だけは旧 `<!-- codex-review-finding -->` マーカーも自分の
  ものとして扱い、`codex-review` からの移行時に旧スレッドを引き継ぐ）
- AI 以外の未解決スレッド（人間のレビュー等）は、モデルが「現在の PR head で対応済み」と
  **コードで確認できたもの**（出力 `resolved_threads`）だけを、収集時点と resolve 直前・
  直後の三段の版照合を経て resolve する（判定不能・未対応は残す fail-closed）

## セキュリティ

多層防御を重ねている。

- fork からの PR ではジョブを実行しない（`preflight` の `if`）
- 資格情報未設定の間は review ジョブを skip する（有効化スイッチ。設定が唯一の有効化操作）
- passwordless sudo を持つ runner では agentic レビューを拒否する（`Verify sudo is not
  available`。API provider はツールを持たないため対象外）
- prompt / schema / `AGENTS.md` 等の制御ファイルは PR の base コミット（信頼済み参照）から
  抽出する。symlink・gitlink は fail-closed で拒否し、欠落時は本リポジトリ同梱の既定版
  （呼び出された workflow と同一 SHA）へフォールバックする
- 作業ツリーの正規化: prompt/schema/`AGENTS.md`/`AGENTS.override.md`/`CLAUDE.md`/
  `CLAUDE.local.md` は base 版へ揃え（base に無ければ削除）、`GEMINI.md` は作業ツリー全体
  から削除（gemini はサブディレクトリも自動注入するため）、各 CLI のプロジェクト設定
  （`.codex` / `.claude` / `.gemini` / `.agents` / `.mcp.json`）と `.env` は削除する
- CLI は `$RUNNER_TEMP` へ固定バージョンで導入する（`latest` 等の可変 dist-tag は拒否）
- API モードは差分・未解決レビュースレッド一覧等を毎回ランダムな nonce 区切りで埋め込み
  （データ区切りの偽装によるプロンプトインジェクションを防ぐ。スレッド本文など PR 参加者が
  書けるデータは指示文側へ連結しない）、リダイレクトを拒否する（別ホストへの Authorization ヘッダ持ち越し
  を防ぐ）
- ログは資格情報パターンをマスクし、`::stop-commands::` で囲んでから公開する
- レビュー出力は公開前に資格情報パターン（+ api-key 認証時はキーの実値）をスキャンし、
  検出時は公開を中止する
- 資格情報に触れる review ジョブと、書き込み権限を持つ post_feedback ジョブを分離する
  （review は `pull-requests: read` のみ）

**API provider（`grok` / `openai-compatible`）では PR の差分が外部 API（xAI / Google 等の
サーバー）へ送信される点に注意する。** private リポジトリでこれらの provider を有効化する
場合は、送信先が信頼できる先か（自社運用の local LLM か、外部 SaaS か）を確認したうえで
判断すること。

## 前提条件

- agentic provider（`codex` / `claude` / `gemini`）は **sudo なしの self-hosted runner が
  必須**（`Verify sudo is not available` が fail-closed で拒否する）。`codex` のみ
  bubblewrap の read-only sandbox を使うため、**unprivileged user namespace の作成が
  許可されている**ことも必要（構築手順は [`docs/self-hosted-runner.md`](docs/self-hosted-runner.md)）
- runner から npm registry（`registry.npmjs.org`）への外向き通信が可能であること
- API provider（`grok` / `openai-compatible`）は GitHub ホステッド runner でも実行できる
  （ツールを持たないため read-only sandbox 等の要件が無い）。ただし local LLM は
  LAN 内の runner が LLM サーバーへ到達できることが必要

## セットアップ

1. **provider を決める**: agentic（codex / claude / gemini）か API（grok / openai-compatible）
   か。複数モデルでの同時レビューにする場合は後述の「複数モデルでの同時レビュー」も参照
2. **runner を用意する**（agentic provider・local LLM の場合）: 手順は
   [`docs/self-hosted-runner.md`](docs/self-hosted-runner.md)
3. **資格情報（Actions variable / secret）を設定する**:

   ```bash
   # home-dir 方式（agentic。例: codex）
   gh variable set CODEX_HOME_DIR --repo Fandhe-AI/<repo> --body /opt/codex-home

   # API キー方式
   gh secret set XAI_API_KEY --repo Fandhe-AI/<repo> --body "<xai api key>"

   # openai-compatible（local LLM）: 送信先 URL と、その許可リスト（完全一致・カンマ区切り）
   gh variable set LOCAL_LLM_BASE_URL --repo Fandhe-AI/<repo> --body http://<llm-node>:8000/v1
   gh variable set AI_REVIEW_API_BASE_URLS --repo Fandhe-AI/<repo> --body http://<llm-node>:8000/v1
   ```

   **資格情報・送信先は Actions variable / secret からのみ解決する**。`home-dir` は
   `*_HOME_DIR` 変数だけから読み（input では受け取らない）、grok の送信先は
   `https://api.x.ai/v1` 固定、openai-compatible の `api-base-url` は許可リスト
   `AI_REVIEW_API_BASE_URLS` との完全一致を必須とする（PR が書き換えられる wrapper の input
   だけで API キー・差分の送信先や CLI の設定ディレクトリが変わらないようにする多層防御）。
   なお wrapper を書き換えられる主体は run ステップの追加等で secret を直接扱えるため、
   `pull_request` で secret を使う workflow 一般の残留リスクは残る

4. **テンプレートをコピーする**:

   ```bash
   mkdir -p .github/workflows
   gh api -H 'Accept: application/vnd.github.raw' \
     repos/Fandhe-AI/actions/contents/ai-review/templates/ai-review.single.yml \
     > .github/workflows/ai-review.yml
   ```

   複数モデルでの同時レビューにする場合は `ai-review.multi.yml` を使う。

5. **動作確認**:

   ```bash
   gh run list --repo Fandhe-AI/<repo> --workflow "AI PR review" --limit 1
   gh run view <run-id> --repo Fandhe-AI/<repo> --json jobs \
     --jq '.jobs[] | {name, status, conclusion}'
   ```

   資格情報未設定の間は review ジョブが `skipped` になり、`preflight` のログに
   `::notice::` で理由（`not-configured` 等）が出る。**skip されたジョブはワークフロー
   全体では成功扱いに見える**ため、初回導入時は必ずジョブ単位で確認する

6. **レビュー基準のカスタマイズ（任意）**: 何も置かなければ同梱既定版
   （`ai-review/prompts/review.md` の汎用レビュー基準）で動く。リポジトリ固有の基準を使う
   場合は以下を base ブランチへコミットする（いずれも PR の base コミットから読まれるため、
   PR 自身がこれらを書き換えても当の PR のレビューには反映されない）:

   | ファイル | 役割 |
   |---|---|
   | `AGENTS.md` | リポジトリ固有の規約・レビュー基準 |
   | `.github/ai-review/prompts/review.md` | レビュー指示文そのもの（`prompt-path` 入力で変更可） |
   | `.github/ai-review/review-schema.json` | 出力 schema（`schema-path` 入力で変更可。`summary`/`findings`/`review_completed` は必須のまま維持する） |

## runner の切り替え

`runner`（review ジョブ）・`post-feedback-runner`（preflight/post_feedback）は、単一ラベル
または JSON 配列文字列を受け取る。

- `runner` の既定値: agentic provider は provider 名と同名の用途ラベル（`codex` / `claude`
  / `gemini`）、API provider は private リポジトリなら `self-hosted`、public なら
  `ubuntu-latest`
- `post-feedback-runner` の既定値: private なら `self-hosted`、public なら `ubuntu-latest`

```yaml
with:
  runner: '["self-hosted","no-sudo","claude"]'
```

local-server の codex 専用プールを流用して claude を動かす場合は `runner: no-sudo` のように
共通ラベルへ寄せる、等の使い方もできる。

JSON 配列はラベルの AND 条件になる（すべてを持つ runner にだけ割り当てられる）。空配列
`[]` は無効（ジョブが起動しない）。

## 複数モデルでの同時レビュー

[`ai-review.multi.yml`](templates/ai-review.multi.yml) は同じ PR を複数の AI が並列にレビュー
するテンプレート。各ジョブ ID が check 名の先頭になる（例 `codex / review`）ため、required
status check には個別ジョブ、またはテンプレート同梱の集約 gate ジョブ `ai-review-gate` を
required にする運用のどちらかを選ぶ。

- 各ジョブの outputs: `reviewed`（レビューが実行され結果が出たか）、`skip-reason`、
  `blocking-count`、`result-artifact`
- `ai-review-gate` は `MIN_REVIEWERS`（既定 1）未満しかレビューが実行されなかった場合に
  失敗する（資格情報の設定漏れで全 reviewer が skip されたまま green になる fail-open を
  防ぐ）。ただし全 reviewer の `skip-reason` が `branch-prefix`（`skip-branch-prefixes` に
  一致）の場合に限り通す（`skip-branch-prefixes` は全 reviewer ジョブに同じ値を渡す）。fork PR を
  受け付ける public リポジトリで本ジョブを required にする場合は、fork PR では全 reviewer が
  起動しないため `MIN_REVIEWERS` の扱いを branch protection 側で設計すること
- 同じ provider を複数ジョブ（例: local LLM 2 モデル）で使う場合は `reviewer-id` を必ず
  ジョブごとに分ける（自動 resolve の識別マーカーが reviewer-id 単位のため）
- quota・API 課金は reviewer の数だけ消費される
- 推奨構成例: `codex + gemini + local LLM`（agentic 2 種 + API 1 種で見落としの型を分散し、
  local LLM で従量課金を抑える）

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `provider` | ✓ | - | `codex` / `claude` / `gemini` / `grok` / `openai-compatible` |
| `reviewer-id` | - | （空。provider 名。`openai-compatible` は `llm`） | インライン指摘の識別マーカーに使う reviewer 識別子（英小文字・数字・ハイフン、32 文字以内）。同一 provider を複数ジョブで使う場合は必ず分ける |
| `reviewer-name` | - | （空。Codex/Claude/Gemini/Grok/LLM） | PR レビュー見出しの表示名 |
| `runner` | - | （空 → 既定ロジック） | review ジョブの runner。単一ラベルまたは JSON 配列 |
| `post-feedback-runner` | - | （空 → 既定ロジック） | preflight / post_feedback の runner。単一ラベルまたは JSON 配列 |
| `model` | - | （空。codex: `gpt-6-sol` / claude: `claude-sonnet-5` / gemini: CLI 既定） | モデル名。grok / openai-compatible では必須。codex の `gpt-6-sol` は CLI 0.156.1 以降が必要（`cli-version` を下げる場合は `model` も合わせる） |
| `reasoning-effort` | - | （空。codex のみ `low` を既定適用） | 推論量。codex: `low`〜`ultra` / claude: `low`〜`max` / API provider: `minimal`〜`max`（`reasoning_effort` として送信）。`"default"` でモデル既定に従う。gemini は非対応 |
| `cli-version` | - | （空。codex: `0.157.0` / claude: `2.1.280` / gemini: `0.60.0`） | agentic provider の CLI 固定バージョン（`latest` 不可） |
| `auth` | - | `auto` | 認証方式。`auto` / `home-dir` / `api-key` |
| `api-base-url` | - | （空） | openai-compatible の OpenAI 互換 base URL。Actions variable `AI_REVIEW_API_BASE_URLS`（カンマ区切りの許可リスト）のいずれかと完全一致が必要（不一致は失敗、許可リスト未設定・空は skip）。grok は `https://api.x.ai/v1` 固定で指定不可 |
| `api-response-format` | - | `json_schema` | `json_schema` / `json_object` / `none` |
| `max-diff-bytes` | - | `300000` | API provider で prompt に埋め込む差分の上限バイト数。超過時は未完了扱い |
| `diff-context-lines` | - | `10` | レビュー入力の差分の文脈行数 |
| `timeout-minutes` | - | `30` | review ジョブの timeout（分） |
| `prompt-path` | - | `.github/ai-review/prompts/review.md` | 呼び出し側リポジトリのレビュー prompt パス（英数字と `. _ / -` のみのリポジトリ相対パス。絶対パス・`..`・`.`・空セグメント・末尾 `/`・先頭 `-` は拒否） |
| `schema-path` | - | `.github/ai-review/review-schema.json` | 呼び出し側リポジトリの出力 schema パス（制約は `prompt-path` と同じ） |
| `block-priorities` | - | `P0,P1` | ジョブを失敗させる指摘の priority（カンマ区切り）。P0/P1 は必須集合（除外不可） |
| `skip-branch-prefixes` | - | （空） | レビューを skip する head branch 名の接頭辞（カンマ区切り。例 `chore/skills-update-,chore/submodule-update-`）。`update-external.yml` の日次同期 PR のような自動生成 PR 用。`preflight` がリテラルの前方一致のみで判定し、一致時は `review` / `post_feedback` を実行しない（`skip-reason: branch-prefix`）。push できる主体はブランチ名で gate を回避できる（後述「受容済み残留リスク」）。接頭辞は自動生成 PR だけが使う十分に限定的な値にする（区切り文字 `-` まで含める） |

### Secrets

| 名前 | 必須 | 説明 |
|---|---|---|
| `API_KEY` | - | `auth: auto` / `api-key` で使用する API キー。codex: OpenAI API キー / claude: Anthropic API キーまたは `claude setup-token` の OAuth トークン（`sk-ant-oat…`）/ gemini: Gemini API キー / grok: xAI API キー / openai-compatible: サーバーの API キー（任意） |

### Outputs

| 名前 | 説明 |
|---|---|
| `result-artifact` | 正規化済みのレビュー結果 JSON（`ai-review.json`）を格納した同一 run 内の artifact 名（skip 時・結果未生成時は空。保持期間 1 日。`actions/download-artifact` で取得する）。結果本体は job output ではなく artifact で受け渡す（大きな結果の上限超過や、登録 secret と一致する部分文字列を含む output を Actions が黙って落とす挙動を避けるため） |
| `blocking-count` | ブロック対象 priority の指摘件数（gate 未到達・skip 時は空） |
| `reviewer-id` | 解決済みの reviewer-id |
| `reviewed` | レビューが実行され結果が出たか（`"true"` / `"false"`） |
| `skip-reason` | skip の理由（`not-configured` / `branch-prefix` / 空） |

## 参照バージョン（`@latest`）

`Fandhe-AI/actions` は可変タグ `@latest` で参照する。`latest` は main への push ごとに
付け替わるため、呼び出し側で参照を更新する作業は不要である。同梱既定 prompt / schema /
スクリプトは `job.workflow_sha`（`@latest` が起動時に解決したコミット）から読まれるため、
workflow 本体と同梱既定制御ファイルは常に同一コミットの組で切り替わる。

## codex-review からの移行

既存の `codex-review.yml` wrapper はそのまま動き続ける（`codex-review.yml` は凍結し
セキュリティ修正のみ行う）。ai-review へ移行する手順:

1. **テンプレートで wrapper を置換する**。`with:` の対応表:

   | codex-review | ai-review | 備考 |
   |---|---|---|
   | `runner-label` | `runner` | |
   | `post-feedback-runner-label` | `post-feedback-runner` | |
   | `codex-version` | `cli-version` | |
   | `model` / `reasoning-effort` / `timeout-minutes` / `block-priorities` / `skip-branch-prefixes` | 同名 | |
   | `skip-sync-pr-review`（旧入力） | `skip-branch-prefixes: chore/skills-update-,chore/submodule-update-` | codex-review でも現在は存在しない入力。残っている wrapper は置き換える |
   | `prompt-path` / `schema-path` | 同名 | 既定パスが `.github/codex/...` から `.github/ai-review/...` へ変わる。カスタム版を置いている場合は移動するか、`prompt-path` / `schema-path` で旧パスを明示する |

   加えて `provider: codex` を指定する（codex-review には無かった必須入力）。

2. **required status check 名が変わる**（旧: `codex-review / codex` 等 → 新: `<job> / preflight` /
   `<job> / review` / `<job> / post_feedback`、または複数モデル構成の集約 gate
   `ai-review-gate`）。wrapper を差し替えた PR には旧 check が届かず、逆に ruleset を先に新名へ
   変えると未移行の他 PR に新 check が届かないため、どちらの順でも放置するとマージ不能になる。
   次の順で行う:
   1. 移行 PR を作る（wrapper 差し替え。新 check が実行・通過することを確認する）
   2. マージ直前に ruleset / branch protection の required checks を旧名から新名へ置き換える
   3. 移行 PR をマージする（以降の PR は新 check のみで判定される）

   本リポジトリ自身の self wrapper も、この手順で `codex-review-self.yml` から
   `ai-review-self.yml` へ移行済み
3. **旧 codex スレッドの引き継ぎ**: `codex` reviewer は旧 `<!-- codex-review-finding -->`
   マーカーも自分のものとして扱うため、移行後の初回レビューで旧スレッドを自動 resolve する

## 注意事項

### `skip-branch-prefixes` の受容済み残留リスク（2026-09-24 オーナー判断）

codex-review から ai-review への移行にあたり、`update-external.yml` が生成する日次同期 PR
（`chore/skills-update-*` / `chore/submodule-update-*`。org 全体で auto-merge 有効）を
レビュー対象外にする head branch 名の接頭辞 skip を ai-review にも導入する。同期 PR は上流の
取り込みそのもので、指摘の修正先が取り込み元の上流リポジトリにしかなく、レビューしても
quota を消費するうえ上流由来の P0/P1 で auto-merge が止まるだけになるためである。
この節は受容判断の記載で、実装は本節を base に含む後続 PR（#144）で導入済み
（入力 `skip-branch-prefixes`。Inputs 表を参照）。

受容する設計は次のとおり（codex-review の `skip-branch-prefixes` と同じ接頭辞のみ判定）:

- 入力 `skip-branch-prefixes`（カンマ区切り、各要素は前後の空白を除去、既定は空）。
  `preflight` ジョブが入力検証の後・資格情報の有効化判定の前に、
  `github.event.pull_request.head.ref` を各接頭辞とリテラルの前方一致で比較する
  （`*` / `?` をパターンとして解釈しない）
- 一致した場合は `review` / `post_feedback` を実行せず、output `skip-reason` を
  `branch-prefix`、`reviewed` を `"false"` にする。provider を問わずその reviewer ジョブ全体が
  skip 対象になる（複数モデル構成では各 reviewer ジョブに同じ値を渡す）
- 複数モデル構成の集約 gate（`ai-review-gate`）は、`MIN_REVIEWERS` の判定で全 reviewer の
  `skip-reason` が `branch-prefix` の場合に限り、レビュー 0 件を許容する
- fork PR では `preflight` 自体が起動しないため、この skip 経路も存在しない
- 判定不能時（`preflight` の失敗・output の欠落）は skip 側へ倒さない（`preflight` の失敗は
  required check の失敗としてマージを止め、集約 gate は `branch-prefix` を明示的に受け取った
  場合にしかレビュー 0 件を許容しない）

**この判定は、リポジトリへ push できる主体による偽装を防げない。** ブランチ名は push
できる誰でも付けられ、GitHub 上に「その PR が同期ワークフロー由来である」ことを示す偽造不能な
signal は無い。したがってこの入力を指定したリポジトリでは、write 権限を持つ主体が指定接頭辞の
ブランチから**任意の変更**を含む PR を出すと、AI レビューと P0/P1 gate を通らずにマージ候補まで
到達できる。

この残留を承知のうえで使用する判断を採っている。根拠は codex-review の同判断
（[`codex-review/README.md`](../codex-review/README.md)「`skip-branch-prefixes` の受容済み残留
リスク」、2026-08-18 判断・2026-08-21 更新）と同じで、次の 2 点。

- 迂回できるのは対象リポジトリへ push できる主体に限られ、Fandhe-AI 配下では実質オーナーと
  その資格情報で動くエージェントで、同期 PR を生成している主体そのものと一致する。
  **write 権限と ruleset 管理権限は別である**ため「迂回できる者は ruleset も変えられる」とは
  言えない点に注意する。第三者の write コラボレーターを迎える場合はこの入力を空へ戻す判断が要る
- Cursor Bugbot は Actions 側の skip の影響を受けず、skip 対象の PR も従来どおりレビューする

指定しないリポジトリ（既定は空）ではこの経路は存在しない。判定不能時に skip 側へ倒す
fail-open 化・fork PR への拡大・接頭辞以外の条件（actor・ラベル等）による skip の新設は
受容範囲外である。

### その他の注意

- 認証情報（`auth.json` / `.credentials.json` / `oauth_creds.json` 等）はパスワード同等。
  コミット・ログ・チケットへ貼らない
- agentic provider の実行は各サービスのプラン・API のレート枠/quota を消費する
- gate を required status check にするかは呼び出し側の branch protection 設定次第。
  資格情報未設定時はジョブが skip されるため、required 化する場合は skip との両立を
  呼び出し側で設計すること
- レビューはセキュリティ境界ではない。最終判断は人間レビューが担う

### トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| review ジョブが `skipped`（PR コメントも出ない） | 資格情報未設定、または fork からの PR | 「セットアップ」3 で variable/secret を設定する。fork PR は仕様上実行しない |
| ジョブが `Waiting for a runner` のまま進まない | runner が未登録・runner group 未許可、または既定の用途ラベル（`codex` / `claude` / `gemini`）を持つ runner が無い | runner group 設定を確認し、runner にラベルを追加するか `runner` 入力で既存ラベルを指定する（`docs/self-hosted-runner.md`） |
| `sudo -n true` の fail-closed 検証で失敗する | ジョブ実行ユーザーが passwordless sudo を持っている | runner のジョブユーザーを sudoers から外す |
| `bwrap: No permissions to create a new namespace`（codex のみ） | unprivileged user namespace が禁止されている | seccomp / AppArmor プロファイルで userns 作成を許可する |
| CLI インストールに失敗する | runner から `registry.npmjs.org` へ到達できない | runner のネットワーク・プロキシ設定を確認する |
| `FatalUntrustedWorkspaceError`（gemini） | 通常は本 workflow が `GEMINI_CLI_TRUST_WORKSPACE=true` を設定済みで回避される | 自前 wrapper で環境変数を上書きしていないか確認する |
| `Verify gemini system policy directory is empty` で失敗する | runner の `/etc/gemini-cli/policies/` に `.toml` が置かれている（`--admin-policy` が無視されるため fail-closed で中止）、または同ディレクトリを読み取れない | 標準システムポリシーディレクトリから撤去する・権限を直す（`docs/self-hosted-runner.md`） |
| API provider で `404 model not found` | `model` の指定ミス、またはサーバーにモデル未登録 | Actions variable の `model` 値とサーバー側の登録名を確認する |
| API provider で schema エラー | サーバーが `json_schema` strict に未対応 | `api-response-format` を `json_object` / `none` へ下げる |
| `review_completed: false`（指摘が処理上限超過） | 指摘が 200 件を超えた（一部だけを完了扱いで投稿すると欠落するため未完了にする） | PR を分割する、または生成ファイル等の指摘が集中する原因を差分から外す |
| `review_completed: false`（差分超過） | `max-diff-bytes` 超過（API provider） | `max-diff-bytes` を引き上げる、または PR を分割する |
| preflight が「api-base-url が … 許可リストに含まれていません」で失敗する | `api-base-url` が Actions variable `AI_REVIEW_API_BASE_URLS` のどの値とも完全一致しない（末尾 `/` の有無も区別する） | 許可リストへ同じ文字列を登録する |
| review ジョブが「home-dir が PR の作業ディレクトリまたはジョブ一時領域の内側を指しています」で失敗する | `*_HOME_DIR` 変数が `$GITHUB_WORKSPACE` / `$RUNNER_TEMP` 配下（symlink 解決後）を指している | runner のマウント先（例 `/opt/codex-home`）へ変更する |
| `Not logged in`（agentic provider） | home-dir の認証切れ | `docs/self-hosted-runner.md` の該当 provider の再ログイン手順を実施する |
