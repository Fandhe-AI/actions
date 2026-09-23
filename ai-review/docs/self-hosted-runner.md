# self-hosted runner 構築（ai-review）

`ai-review` の agentic provider（`codex` / `claude` / `gemini`）と、`openai-compatible`
provider を local LLM に向ける構成で使う self-hosted runner の構築手順。全体像・provider 別
の要点・local LLM への接続を扱う。**IP アドレス・実ホスト名・トークン・メールアドレスは
記載しない**（ホスト名は `<llm-node>` 等のプレースホルダで表す）。

## 全体像

Proxmox VM 上の Docker コンテナ型永続 runner（`myoung34/github-runner:ubuntu-noble` ベース）
を前提とする。ホストへ直接インストールする構成でも要件（sudo なし・home-dir 等）は同じ。

- **汎用プール**: root・sudo あり、ラベル例 `fandhe-server/self-hosted`。通常の CI ジョブ用
- **AI レビュー専用プール**: 非 root（uid 1001 等）・sudo 完全剥奪、`NO_DEFAULT_LABELS=true`
  で `self-hosted` ラベルを付けない、ラベル例 `fandhe-server,no-sudo,codex`。**この専用プール
  に他ジョブを混ぜない**（ai-review が読み取り専用を前提にしているため、他ジョブの副作用で
  作業ツリー・環境が汚染される経路を避ける）

## 共通要件

- ジョブ実行ユーザーは非 root・sudo 無し。Dockerfile で `deluser runner sudo` +
  sudoers 該当行の削除を行い、ビルド時に `sudo -n true` が失敗することを検証する
- `docker.sock` をコンテナへ mount しない
- runner group は信頼できるリポジトリに限定する
- ラベル: ai-review の `runner` 既定値は provider 名と同名ラベル（`codex` / `claude` /
  `gemini`）なので、専用プールの `RUNNER_LABELS` に `claude` / `gemini` を追加するか、
  wrapper 側で `runner: no-sudo` のように共通ラベルを明示的に渡す

## provider 別

### codex

bubblewrap による read-only sandbox のため **unprivileged user namespace** が必要。
`--privileged` は使わず、以下を同時に適用する:

- **カスタム seccomp プロファイル**: moby の既定プロファイルから `clone` / `clone3` /
  `mount` / `pivot_root` / `setns` / `umount` / `umount2` / `unshare` を、`CAP_SYS_ADMIN`
  条件付き許可から無条件 allow へ変更する
- **named AppArmor プロファイル**: `/etc/apparmor.d/` へ配置し、
  `systemctl reload apparmor.service` で反映する

**CODEX_HOME**: ホスト側ディレクトリ（例 `/opt/codex-home`、パーミッション `700`、所有者
runner のジョブユーザー uid）をコンテナへ **rw** mount する（refresh token 更新のため）。

```bash
CODEX_HOME=<dir> codex login --device-auth
chmod 600 <dir>/auth.json
```

Actions variable `CODEX_HOME_DIR` にはコンテナ内のパスを設定する。

アカウント切替はスクリプト化する（Runner.Worker が実行中でないことを確認 → 旧 `auth.json`
退避 → `--device-auth` で再認証 → 検証 → 失敗時ロールバック、の順）。**同一 `auth.json` を
複数コンテナで rw 共有すると refresh 競合の残留リスクがある**点に留意する。

### claude

userns 不要（Bash ツールを使わないため sandbox 自体が不要）。

- **home-dir 方式**: `CLAUDE_CONFIG_DIR` 用ディレクトリ（例 `/opt/claude-home`、`700`）を
  用意し、`CLAUDE_CONFIG_DIR=/opt/claude-home claude` を対話起動して `/login` で認証する。
  `.credentials.json` は `600` にする。Actions variable `CLAUDE_HOME_DIR` にコンテナ内パスを
  設定する
- **代替（API_KEY 方式）**: `claude setup-token` で発行した長期 OAuth トークン
  （`sk-ant-oat…`、Pro/Max 等のサブスクリプション枠で動作）を secret `API_KEY` に渡す、
  または通常の Anthropic API キーを渡す。この場合、runner 側でホームディレクトリの用意は
  不要

### gemini

userns 不要。

- **home-dir 方式**: `GEMINI_CLI_HOME`（例 `/opt/gemini-home`。配下に `.gemini/` が作られる）
  を用意し、`GEMINI_CLI_HOME=/opt/gemini-home gemini` を対話起動して Google ログインする
  （`oauth_creds.json` が生成される。`settings.json` に認証種別も保存される）。
  `history/` `tmp/` を書き込むため rw mount する。Actions variable `GEMINI_HOME_DIR` に
  コンテナ内パスを設定する
- **`/etc/gemini-cli/policies/` に `.toml` を置かない**。置くと workflow の
  `--admin-policy`（読み取り系以外を全拒否する補助ポリシー）が無視される（gemini-cli の
  仕様）。workflow は実行前に同ディレクトリを検査し、`.toml` が存在する・内容を確認できない
  （読み取り不可等）場合はレビューを中止する（fail-closed）
- ホーム側 `.gemini/GEMINI.md`（グローバルメモリ）を置かない
- gemini CLI にはセッション履歴を残さないオプションが無く、home-dir 方式では実行のたびに
  `.gemini/history/`・`.gemini/tmp/`・`projects.json` が蓄積する（ディスク消費に加え、将来
  CLI が履歴を次回実行のコンテキストへ使う変更が入った場合の PR 間汚染の芽になる）。
  ホスト側で定期的に削除する（例: systemd timer / cron で
  `find /opt/gemini-home/.gemini/history /opt/gemini-home/.gemini/tmp -mindepth 1 -mtime +1 -delete`）。
  `oauth_creds.json`・`settings.json` は消さないこと
- **API_KEY 方式**なら runner 側の準備は不要

### API provider（grok / openai-compatible）

sudo 検証・ツール実行のいずれも無いため、汎用プール・GitHub ホステッドでも成立する。
ただし local LLM（`openai-compatible` を LAN 内サーバーへ向ける場合）は LLM サーバーへ
到達できる LAN 内 runner が必要。

## local LLM（DGX Spark 上の vLLM）の接続

vLLM は OpenAI 互換 `http://<llm-node>:8000/v1` を提供する（`--enable-auto-tool-choice` 等の
既存設定はそのままでよい。ai-review はツールを一切使わず `response_format: json_schema` を
送るだけで、vLLM は structured outputs（xgrammar）で `json_schema` に対応する）。

自作 gateway（local-llm-server）は `127.0.0.1:8080` bind のため runner からは到達できない。
以下のいずれかを選ぶ:

- vLLM を直接叩く（`api-base-url` に vLLM の endpoint を指定）
- gateway の bind を LAN 側へ変更する（この場合は API キー認証を有効化し、secret `API_KEY`
  で渡す）

到達性の確認:

```bash
curl -s http://<llm-node>:8000/v1/models
```

Actions variable `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_MODEL` を設定する（テンプレート
`ai-review.single.yml` / `ai-review.multi.yml` の `local-llm` ジョブが参照する）。加えて
送信先の許可リスト `AI_REVIEW_API_BASE_URLS` に同じ URL を登録する（`api-base-url` との
完全一致が必要。未設定の間は skip、不一致は失敗。複数の LLM サーバーを使う場合はカンマ区切り）。

**モデル選定の目安**: コンテキスト長が長いものを推奨する（例: deepseek-v4-flash 系
384K、qwen3.6-35b-a3b 系 262K、minimax-m2.7 系 196K）。`max-diff-bytes` はコンテキスト長の
半分程度までを目安にする（1 トークン ≒ 3〜4 バイト）。推論モデルが出す `<think>` ブロックは
`normalize-output.mjs` が除去してから JSON を抽出する。

**注意**: vLLM 直下が無認証の場合、到達できる LAN 内の誰でも使える状態になる。必要に応じて
vLLM 側またはネットワーク側で制限すること。

## 動作確認コマンド

```bash
# コンテナ内のジョブ実行ユーザーで:
sudo -n true                              # → 失敗すること（sudo なし）
bwrap --unshare-all --ro-bind / / true    # → 成功すること（codex のみ。userns 許可）

# 各 CLI の login status（home-dir 方式の場合）
CODEX_HOME=<dir> codex login status
CLAUDE_CONFIG_DIR=<dir> claude /status    # または CLI の対応するステータス確認手段
GEMINI_CLI_HOME=<dir> gemini /auth        # または CLI の対応するステータス確認手段
```

## 関連

- [`../README.md`](../README.md) — provider 一覧・セットアップ・Inputs
- [`runner-exception.md`](runner-exception.md) — public リポジトリでの runner 例外
- [`../../codex-review/README.md`](../../codex-review/README.md) — codex-review（凍結）の
  従来の runner 構築手順
