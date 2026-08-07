# idempotent-issue

ラベルの冪等な作成 → 重複検索 → 未存在時のみ Issue を起票する Composite Action。

CI からの自動 Issue 起票（監査検知・性能退行検知など）で頻出する
「ラベルの冪等な用意 → `gh issue list --search` で open Issue の重複を確認 →
未存在なら `gh issue create --body-file`」のパターンを一般化しています。
ラベルは存在確認のうえ、未存在なら `gh label create` で作成し、既存なら
`label-color` / `label-description` が明示されている場合のみ `gh label edit` で
該当項目だけを更新します（未指定なら既存ラベルに触れず、色が変異しません）。
同一検索条件 + 同一ラベルの open Issue が既にある場合は起票せずスキップし、
何度実行しても Issue が重複しません（冪等）。

## 前提条件

- `gh` CLI が runner に導入済み（GitHub ホステッド runner は導入済み。self-hosted runner は要確認）
- トークンに対象リポジトリの Issues Read/Write 権限があること
  - 同一リポジトリなら `${{ github.token }}`（既定値）で可。ジョブに `issues: write` の
    permissions が必要

## セットアップ

### 1. permissions を設定

同一リポジトリへの起票であれば Secrets の追加登録は不要です。起票を行うジョブに
`issues: write` を付与してください（workflow 全体は最小権限を維持し、ジョブ単位で付与を推奨）。

```yaml
permissions:
  contents: read
  issues: write
```

### 2. ワークフローファイルを作成

#### 例1: 依存監査（audit-triage）の検知を advisory ID ごとに起票

`scripts/audit-triage.sh` が検知した advisory ID ごとに、既存 open Issue がなければ起票する例
（ci.yml dep-audit ジョブの起票ステップを置換する使い方）:

```yaml
- name: audit-triage の Issue 起票
  if: always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch')
  uses: Fandhe-AI/actions/idempotent-issue@<SHA> # main
  with:
    label: audit-triage
    label-color: B60205
    label-description: 'cargo audit 指摘の自動トリアージ Issue（TASK-12.1-1, #79）'
    search-query: ${{ steps.triage.outputs.advisory-id }}
    title: 'audit-triage: ${{ steps.triage.outputs.advisory-id }} の対応要否を確認'
    body-file: ${{ steps.triage.outputs.report-file }}
    token: ${{ secrets.GITHUB_TOKEN }}
```

#### 例2: 週次ベンチの性能退行（bench-regression）検知を起票

`bench-schedule.yml` の bench-regression 起票ステップを置換する使い方:

```yaml
- name: bench-regression の Issue 起票
  if: always() && steps.bench.outcome == 'success' && steps.bench.outputs.status != '0'
  uses: Fandhe-AI/actions/idempotent-issue@<SHA> # main
  with:
    label: bench-regression
    label-color: B60205
    label-description: '週次ベンチ（bench-schedule.yml）の REQ-1/NFR-1 退行・計測不能検知（イシュー #285）'
    search-query: bench-regression
    title: 'bench-regression: REQ-1/NFR-1 性能退行を検知'
    body-file: ${{ runner.temp }}/bench-report.md
    token: ${{ secrets.GITHUB_TOKEN }}
```

#### 例3: outputs を後続ステップで使う

```yaml
- name: Issue 起票（冪等）
  id: issue
  uses: Fandhe-AI/actions/idempotent-issue@<SHA> # main
  with:
    label: my-alert
    search-query: 'my-alert: 検知'
    title: 'my-alert: 検知内容の確認'
    body-file: ${{ runner.temp }}/report.md

- name: 結果を表示
  env:
    CREATED: ${{ steps.issue.outputs.created }}
    ISSUE_URL: ${{ steps.issue.outputs.issue-url }}
  run: |
    if [ "${CREATED}" = "true" ]; then
      echo "新規起票: ${ISSUE_URL}"
    else
      echo "既存 open Issue のため起票スキップ: ${ISSUE_URL}"
    fi
```

## Inputs

| 名前 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `label` | Yes | - | 起票 Issue に付与するラベル名（重複検索の絞り込みにも使用） |
| `label-color` | No | （gh の既定値） | ラベルの色（6 桁 16 進、例: `B60205`） |
| `label-description` | No | （設定しない） | ラベルの説明 |
| `search-query` | Yes | - | 重複確認に使う検索クエリ（`gh issue list --search` へデータとして渡す） |
| `title` | Yes | - | 起票する Issue のタイトル |
| `body-file` | Yes | - | Issue 本文の Markdown ファイルパス |
| `token` | No | `${{ github.token }}` | ラベル作成・Issue 検索・起票に使用するトークン（Issues Read/Write 権限） |

## Outputs

| 名前 | 説明 |
|---|---|
| `created` | 新規起票したら `true`、既存 open Issue があり起票をスキップしたら `false` |
| `issue-number` | 新規起票した Issue、または検知した既存 open Issue の番号 |
| `issue-url` | 新規起票した Issue、または検知した既存 open Issue の URL |

## SHA の更新方法

セキュリティのため、Action は `@main` ではなくコミット SHA で固定しています。
`actions` リポジトリを更新した場合は、以下の手順で SHA を更新してください：

```bash
# actions リポジトリの main 最新コミット SHA を取得
# （本リポジトリは private のため、認証済み gh CLI で解決する）
gh api repos/Fandhe-AI/actions/commits/main --jq '.sha'

# ワークフロー内の SHA を新しい値に置き換え
```

## 注意事項

- **重複判定の粒度**: 「`search-query` に一致し、かつ `label` が付いた open Issue」の有無で
  判定します。closed Issue は対象外のため、既存 Issue をクローズすると次回検知時に再起票されます
  （検知の再通知として意図した挙動）
- **ラベルも冪等に扱う**: 既存ラベルは `label-color` / `label-description` が明示された
  場合のみ該当項目を `gh label edit` で更新し、未指定なら一切変更しません
  （無条件 `--force` 作成だと color 未指定時に gh がランダム色を選び直し、実行のたびに
  ラベル色が変わってしまうため）
- **ラベル処理の失敗は警告のみ**: ラベルの作成・更新が gh の一時障害で失敗しても
  本処理（重複判定・起票）は続行します。存在確認（`gh label list`）自体が失敗した場合は、
  コールドスタート（ラベル未存在）でも起票が通るよう `--force` なしの `gh label create` を
  フォールバックとして試みます（既存ラベルなら already exists で失敗しますが警告のみで
  続行し、色は変異しません）。一方、**重複検索の失敗はフェイルクローズ**で
  ステップを異常終了させます（検索失敗時に起票を強行すると重複起票のリスクがあるため）
- **`search-query` はデータとして渡される**: 入力値は `env:` 経由でシェル変数に渡し、
  コマンド文字列へは埋め込みません。ただし GitHub 検索構文（`in:title` 等）としては
  解釈されるため、advisory ID のような一意で安定した文字列を推奨します
- **並行実行の競合**: 同一条件の起票が複数ジョブで厳密に同時実行された場合、
  検索と起票の間の競合により稀に重複しえます（GitHub API にアトミックな
  「検索して未存在なら作成」がないため）。concurrency グループでの直列化を推奨します
- **`actions` リポジトリのアクセス**: org の Settings → Actions → General で
  プライベートリポジトリからの Action 共有を許可する必要あり
