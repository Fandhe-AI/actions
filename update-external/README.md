# update-external

外部ソース（submodule 参照 / エージェントスキル）の定期更新を束ねた reusable workflow。
実体は [`.github/workflows/update-external.yml`](../.github/workflows/update-external.yml)。

呼び出し側リポジトリは wrapper 1 ファイルだけを持ち、更新ロジック・fail-closed ガード・
外部 action の pin はすべて本リポジトリ側で集中管理する。

## なぜ reusable workflow なのか

`skills-update` が下流へ配布するのは `.agents/skills/**` と `skills-lock.json` だけで、
`.github/workflows/**` は配布対象外である。そのため上流テンプレートを強化しても下流へ届かず、
反映手段が全リポへの手 push しか無かった。実際に乖離が固定化していた（2026-08-16 実測、
`Fandhe-AI/agent-cli-skills` イシュー #261）。

| 観点 | 適合 | 未適合 |
|------|------|--------|
| skills ジョブの `persist-credentials: false` | 4 | 17 |
| `source-token` の明示 | 1 | 20 |
| `auto-merge-immediate-fallback: 'false'` | 2 | 19（fail-open の既定 true） |
| Node LTS 24.19.0 | 2 | 19（うち 13 は EOL の major 指定 `'20'`） |

reusable 化により、下流が持つのは wrapper 1 ファイルだけになり、上記の強化は本ファイルの
更新だけで全リポへ届く（pin SHA の更新は別途必要。後述）。

## セットアップ

1. [`templates/update-external.yml`](./templates/update-external.yml) を呼び出し側リポジトリの
   `.github/workflows/update-external.yml` へコピーする
2. `<SHA>` を本リポジトリのコミット SHA へ差し替える（`@main` 参照は不可）
3. リポジトリ固有の設定（`runner-json`・`enable-submodule`・`enable-skills`）を調整する。
   既定でよい行は削除してよい
4. 書き込み権限付き PAT を Secrets へ登録する（`SUBMODULE_PAT` / `SKILLS_PAT`。
   組織シークレットが visibility: all で登録済みならリポジトリ側の作業は不要）
5. `dependencies` / `automated` ラベルを作成する（無いと `gh pr create --label` が
   exit 1 になり同期 PR が作られない）
6. `workflow_dispatch` で 1 回手動実行し、PR が作成されることを確認する

## inputs

| input | 既定 | 説明 |
|-------|------|------|
| `target` | `all` | 更新対象（`all` / `submodule` / `skill`）。値域外は `validate-inputs` ジョブが fail-closed で失敗させる（「成功したのに何も更新していない」を作らない）。wrapper の `workflow_dispatch` も choice 型にして値域を固定する |
| `runner-json` | `'"ubuntu-latest"'` | `runs-on` へ渡す **JSON リテラル**。単一ラベルは `'"ubuntu-latest"'`、複数ラベルは `'["self-hosted","Linux"]'`。素の `self-hosted` は JSON として不正で workflow が起動しない |
| `base-branch` | `main` | 更新対象ブランチ。checkout の `ref`・`.gitmodules` の存在判定・composite action の `base-branch` すべてに同じ値を使う |
| `enable-submodule` | `true` | submodule 更新ジョブの要否。`.gitmodules` を持つが pin 固定運用で自動更新したくないリポジトリは `false` |
| `enable-skills` | `true` | スキル更新ジョブの要否 |
| `submodule-auto-merge` | `'false'` | submodule 更新 PR の auto-merge（`'true'` / `'false'` の文字列） |
| `submodule-auto-merge-allowlist` | `''` | 同 allowlist |
| `skills-auto-merge` | `'false'` | スキル更新 PR の auto-merge |
| `skills-auto-merge-allowlist` | `''` | 同 allowlist |

`node-version`（`24.19.0`）・`skills-version`（`1.5.22`）・`auto-merge-immediate-fallback`
（`'false'`）は **input にしていない**。ランタイムのサポート状況・CLI バージョン・
fail-open の抑止はリポジトリ固有の事情ではなく、集中管理して一斉に更新すべき項目のため
（各リポジトリの設定ミスで fail-open が復活する経路を作らない）。

## secrets

| secret | 必須 | 説明 |
|--------|------|------|
| `SUBMODULE_PAT` | 条件付き | submodule の fetch・push・PR 作成に使う書き込み PAT。`.gitmodules` を持つリポジトリでは必須 |
| `SKILLS_PAT` | 条件付き | スキル更新の push・PR 作成に使う書き込み PAT。未設定時は `SUBMODULE_PAT` を流用する |

`secrets: inherit` ではなく 2 種を明示宣言している。本 workflow は public リポジトリに置かれ、
書き込み権限付き PAT を扱うため、渡される資格情報の面を列挙して固定する。

いずれも未設定（wrapper の `secrets:` で渡されていない場合を含む）なら、checkout より前の
ガードがジョブを失敗させる。`GITHUB_TOKEN` へのフォールバックは廃止済み（bot 作成 PR が
`pull_request` workflow を発火させず、必須チェック未実行で恒久 BLOCKED になるため）。

## リポジトリ固有差分の吸収

下流には正当な差分が実在するため、全置換ではなく input で吸収する。

| 差分 | 実例 | 吸収方法 |
|------|------|---------|
| runner | `rust-ai-library` は public 化に伴い `ubuntu-latest`、`yadori` は `self-hosted` | `runner-json` |
| submodule 更新の要否 | `yadori` は `.gitmodules` を持つが submodule ジョブを持たない | `enable-submodule` |
| `.gitmodules` を持たない | `actions` 本体 | 存在判定ステップが自動 skip（設定不要） |
| auto-merge の ON/OFF | 組織変数で集中管理 | `submodule-auto-merge` / `skills-auto-merge` |

## pin SHA の更新（未解決の運用課題）

wrapper の `@<SHA>` は手動更新が必要である。本リポジトリはタグ・リリースを 1 件も公開して
いないため（2026-08-17 実測: `GET /repos/Fandhe-AI/actions/tags` → 0 件、`/releases` → 0 件）、
Dependabot の `github-actions` エコシステムが解決先バージョンを持てず、SHA pin を自動更新
できない。

したがって現時点で reusable 化が解消したのは「**強化内容の配布**」であり、「pin SHA の
配布」は残っている。ただし更新対象は 600 行超のテンプレート全体から wrapper の 1 行へ縮む。

恒久対応の候補（未着手）:

- 本リポジトリでタグ（`v1` 等）を公開し、Dependabot に SHA 更新を任せる
- 上流に pin SHA 更新 PR を各リポジトリへ開くジョブを設ける（`workflows` スコープ付き PAT が必要）

## 移行手順（既存の update-external.yml を持つリポジトリ）

1. 既存ファイルのリポジトリ固有差分を確認する（`runs-on`・submodule ジョブの有無・
   `base-branch`）
2. テンプレートで置き換え、確認した差分を `with:` へ移す
3. `workflow_dispatch` で 1 回実行し、`skills` / `submodule` 両ジョブの結論が移行前と
   一致することを確認する（skip すべきジョブが skip され、実行すべきジョブが PR を作る）

## 関連

- [`skills-update`](../skills-update/README.md) — スキル更新の composite action
- [`submodule-update`](../submodule-update/README.md) — submodule 更新の composite action
- `Fandhe-AI/agent-cli-skills` イシュー #259 — reusable 化の設計判断と却下案
