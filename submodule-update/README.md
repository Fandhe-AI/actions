# submodule-update

git submodule を最新に追従させ、変更があれば PR を自動作成する Composite Action。

`schedule:` (cron) と組み合わせて毎日実行することで、submodule の更新を検知して自動的に PR を起票します。

## 前提条件

- 呼び出しワークフローで `actions/checkout@v4` を `submodules: recursive` 付きで実行済みであること
- push と PR 作成に必要なトークンを用意
  - 同一リポジトリかつ submodule が public: `GITHUB_TOKEN` (ワークフロー側で `contents: write` / `pull-requests: write` permission を付与)
  - private submodule を含む、または組織外リポジトリにアクセスする場合: fine-grained PAT (contents: write / pull-requests: write)

## セットアップ

### 1. Secrets を登録

リポジトリの Settings → Secrets and variables → Actions に以下を追加（PAT 利用時のみ）:

| Secret 名 | 値 |
|---|---|
| `SUBMODULE_PAT` | fine-grained PAT（private submodule 利用時） |

### 2. ワークフローファイルを作成

#### 例1: 毎日 09:00 JST に submodule を更新

```yaml
name: Update submodules

on:
  schedule:
    - cron: '0 0 * * *'   # 00:00 UTC = 09:00 JST
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          token: ${{ secrets.SUBMODULE_PAT }}
      - uses: Fandhe-AI/actions/submodule-update@<SHA> # main
        with:
          token: ${{ secrets.SUBMODULE_PAT }}
```

#### 例2: submodule の追従ブランチを `develop` に指定

```yaml
- uses: Fandhe-AI/actions/submodule-update@<SHA> # main
  with:
    token: ${{ secrets.SUBMODULE_PAT }}
    submodule-branch: develop
    branch-prefix: chore/submodule-develop
    pr-labels: 'dependencies,automated'
```

#### 例3: 特定 submodule のみを更新

```yaml
- uses: Fandhe-AI/actions/submodule-update@<SHA> # main
  with:
    token: ${{ secrets.SUBMODULE_PAT }}
    submodule-path: vendor/shared-lib
    base-branch: main
```

#### 例4: 自動マージを有効化（`vars` で制御）

PR 作成後、条件を満たせば自動的にマージできます。ON/OFF と allowlist は repository
variables で制御し、ワークフロー側はそれを渡すだけで済みます。

```yaml
- name: Update submodules and open PR
  uses: Fandhe-AI/actions/submodule-update@<SHA> # main
  with:
    token: ${{ secrets.SUBMODULE_PAT || secrets.GITHUB_TOKEN }}
    base-branch: main
    auto-merge: ${{ vars.SUBMODULE_AUTO_MERGE }}
    auto-merge-allowlist: ${{ vars.SUBMODULE_AUTO_MERGE_ALLOWLIST }}
    auto-merge-strategy: squash
```

repository variables（Settings → Secrets and variables → Actions → Variables）:

| Variable 名 | 例 | 説明 |
|---|---|---|
| `SUBMODULE_AUTO_MERGE` | （未設定）/ `false` | **未設定なら自動マージ有効**。無効化したいときだけ `false` 等を設定 |
| `SUBMODULE_AUTO_MERGE_ALLOWLIST` | `docs/**` | 自動マージを許可する submodule path（未指定なら全許可） |

> **注意（空＝有効 / 既定＝無効 の非対称）**: `auto-merge` input は既存互換のため
> 既定値が `'false'`（＝input を一切渡さなければ自動マージしない）ですが、空文字を
> 渡した場合は「有効」に倒します。これは consumer が `${{ vars.SUBMODULE_AUTO_MERGE }}`
> を渡し、**variable 未設定（空文字）＝有効** としたいためです。
> 自動マージを使わないなら `auto-merge` input を渡さないでください。

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `token` | Yes | - | push と PR 作成に使うトークン (contents: write, pull-requests: write) |
| `base-branch` | No | `main` | PR の向き先ブランチ |
| `branch-prefix` | No | `chore/submodule-update` | 自動生成するブランチ名の prefix。最終ブランチ名は `{prefix}-{YYYYMMDD}` (UTC) |
| `submodule-path` | No | `` (全 submodule) | 更新対象の submodule パス |
| `submodule-branch` | No | `` (`.gitmodules` 準拠) | submodule で追従するブランチ名。指定時は対象 submodule の `.gitmodules` 設定を一時的に上書き |
| `commit-message` | No | `chore: submodule を最新に更新` | コミットメッセージ |
| `pr-title` | No | `chore: submodule を最新に更新` | PR タイトル |
| `pr-body` | No | 自動生成 | PR 本文。空時は変更サマリを自動挿入 |
| `pr-labels` | No | `` | PR に付与するラベル (カンマ区切り) |
| `git-user-name` | No | `github-actions[bot]` | コミット作成者名 |
| `git-user-email` | No | `41898282+github-actions[bot]@users.noreply.github.com` | コミット作成者メール |
| `auto-merge` | No | `false` | 自動マージの ON/OFF。`''`(空)/`true`/`yes`/`on`/`1`/`enabled` → 有効、`false`/`no`/`off`/`0`/`disabled` → 無効、解釈不能値は安全側で無効。**input 既定は `false` だが空文字は「有効」**（上記の非対称を参照） |
| `auto-merge-allowlist` | No | `` (全許可) | 自動マージを許可する submodule path。改行/カンマ区切り、各エントリは biome scanner 準拠 glob（下記） |
| `auto-merge-strategy` | No | `squash` | マージ戦略 (`squash`/`rebase`/`merge`) |
| `auto-merge-immediate-fallback` | No | `true` | `gh pr merge --auto` が `allow_auto_merge:false` で失敗した時に即時マージへフォールバックするか |

## Outputs

| 名前 | 説明 |
|---|---|
| `has-changes` | submodule に更新があったかどうか (`true`/`false`) |
| `branch-name` | 自動生成したブランチ名 |
| `pr-url` | 作成または更新した PR の URL |
| `merged` | auto-merge を実行（有効化 or 即時マージ）したかどうか (`true`/`false`) |
| `auto-merge-skipped-reason` | スキップ時の理由。`disabled` / `unparseable-switch` / `unknown-paths` / `not-allowlisted` のいずれか |

## allowlist の glob 仕様（biome scanner 準拠）

[biome scanner](https://biomejs.dev/reference/configuration/#interaction-with-the-scanner) のセマンティクスに準拠します。判定対象は **action が bump した submodule path**（PR の変更ファイルからの逆算ではなく、内部で保持した正確なパス）です。

- `*` … パスセパレータ `/` を**跨がない**任意文字列
- `**` … セパレータを**跨ぐ**任意文字列
- `?` … セパレータ以外の 1 文字
- 先頭 `!` … negation（除外）。後続パターンで再包含も可
- **順次評価・last-match-wins**: 最後にマッチしたパターンで決まる。どのパターンにもマッチしなければ**不許可**

| パターン | 意味 |
|---|---|
| （未指定） | 全 submodule を許可 |
| `vendor/*` | `vendor/` 直下の submodule を許可（さらに深い階層は不可） |
| `docs/**` | `docs/` 配下を再帰的に許可 |
| `**,!vendor/**` | `vendor/` 以外を全許可 |
| `**,!docs/**,docs/spec` | `docs/` 配下を除外しつつ `docs/spec` だけ再許可（例外の例外） |

判定は **PR 単位**で行われ、今回 bump した submodule が**すべて** allowlist を通った時だけマージします。1 つでも対象外なら手動レビュー（マージしない）。allowlist 指定済みなのに bump path を特定できない場合も安全側で手動レビューになります。

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定しています。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新してください：

```bash
# actions リポジトリの最新コミット SHA を取得
git ls-remote https://github.com/Fandhe-AI/actions.git HEAD

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- ブランチ名は `{branch-prefix}-{YYYYMMDD}` 形式で **自動生成** (UTC 日付)。同日中の再実行では `--force-with-lease` で既存ブランチを上書きし、既存 PR を更新します。日をまたぐと新しい PR が起票されます
- `submodule-branch` は `.gitmodules` の `branch` 設定を **ワークフロー実行中のみ一時的に上書き** します。`.gitmodules` 自体は PR にコミットされません (`.gitmodules` の永続変更が必要な場合は別途手動コミットしてください)
- private submodule を含む場合は `GITHUB_TOKEN` では不足するため、fine-grained PAT が必要です (`actions/checkout` と本 Action の両方に同じトークンを渡してください)
- `base-branch` に branch protection がある場合、PR マージには追加のレビュー設定が必要
- 同名ブランチに人間が直接 push している場合、`--force-with-lease` が失敗する可能性があります。自動更新専用のブランチ prefix を維持してください
- **auto-merge に渡す token は fine-grained PAT（`contents: write` + `pull-requests: write` のみ）を推奨**します。`gh pr merge --auto` を使うにはリポジトリの "Allow auto-merge" 設定が必要です（無効でも `auto-merge-immediate-fallback: true` なら即時マージにフォールバックします）
- `auto-merge-immediate-fallback`（既定 `true`）が有効な場合、`--auto` が使えない環境では**必須チェックやレビューの完了を待たずに即時マージ**します。レビューや CI を必須にしたい場合は `base-branch` に branch protection（required status checks / required reviews）を設定するか、`auto-merge-immediate-fallback: false` を指定してください
- `auto-merge` の既定値は `false`（input を渡さなければ従来どおり自動マージしない）ですが、**空文字を渡すと「有効」** に解釈されます。`${{ vars.SUBMODULE_AUTO_MERGE }}` を渡して「variable 未設定＝有効」とする運用を想定した非対称です
