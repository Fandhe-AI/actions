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

## Outputs

| 名前 | 説明 |
|---|---|
| `has-changes` | submodule に更新があったかどうか (`true`/`false`) |
| `branch-name` | 自動生成したブランチ名 |
| `pr-url` | 作成または更新した PR の URL |

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
