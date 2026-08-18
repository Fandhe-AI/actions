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
2. 参照は `@latest` のまま使う（`latest` は main へ自動追従するため差し替え不要）
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
| `submodule-auto-merge` | `'false'` | submodule 更新 PR の auto-merge（`'true'` / `'false'` の文字列）。値域外は `validate-inputs` ジョブが fail-closed で失敗させる（`'yes'` 等が composite action へ素通りして auto-merge が意図せず有効になる fail-open を塞ぐ）。組織変数へ `True` / `1` を入れている場合は `true` / `false` へ直す |
| `submodule-auto-merge-allowlist` | `''` | 同 allowlist |
| `skills-auto-merge` | `'false'` | スキル更新 PR の auto-merge。値域検証は `submodule-auto-merge` と同じ |
| `skills-auto-merge-allowlist` | `''` | 同 allowlist |
| `submodule-close-superseded` | `'false'` | 古い submodule 更新 PR（最新日付ブランチ以外）を close するか（`'true'` / `'false'` の文字列）。値域外は `validate-inputs` ジョブが fail-closed で失敗させる |
| `skills-close-superseded` | `'false'` | 古いスキル更新 PR を close するか。値域検証は `submodule-close-superseded` と同じ |
| `skills` | `''` | 更新対象のスキル名（改行 / カンマ / 空白区切り）。空なら全スキル更新（従来の挙動）。composite action `skills-update` の同名入力へ透過する。自由記述のため値域検証は行わない（`*-auto-merge-allowlist` と同じ扱い） |

### 古い日次更新 PR の自動 close

更新 PR のブランチ名は `{prefix}-{YYYYMMDD}` で日次に作り直されるため、マージされずに残った
過去日付の PR は常に superseded になる（同じ内容が翌日のブランチで再生成される）。
`*-close-superseded` を `'true'` にすると、更新ステップの後に最新日付の 1 件だけを残して
残りを close + ブランチ削除する。

#### 対象の絞り込み

| 条件 | 効果 |
|------|------|
| `--base ${base-branch}` + `select(.baseRefName == $base)` | `base-branch` を base とする PR のみ。同じ prefix で別 base（release ブランチ等）の PR を誤って close しない。別 base の新しい PR に「最新」を奪われて保持すべき PR が閉じられることも防ぐ |
| `select(.isCrossRepository | not)` | fork 由来 PR を除外 |
| 日付部が `^[0-9]{8}$` に完全一致 | prefix が前方一致するだけの無関係ブランチを除外 |

base の絞り込みは **サーバー側（`--base`）とフィルタ側（`baseRefName`）に二重**に置いている。
サーバー側は転送量・レート消費の削減、フィルタ側はオフラインでの検証可能性のため
（テストの fixture は `gh pr list` の**出力**を模すため、サーバー側だけに寄せると base
絞り込みが検証不能になり、テスト済みのガードを未テストのガードへ置き換えることになる）。

細工したブランチ名で正規 PR を close させられる余地を残さないため、prefix と base は
`jq --arg` で値渡しする。

#### close 失敗とブランチ削除失敗の扱い（非対称）

`gh pr close --delete-branch` は使わず、**PR の close と ref の削除を別操作に分けている**。
両者は契約が異なるため、失敗時の扱いも変える。

| 操作 | 失敗時 | 理由 |
|------|--------|------|
| PR の close | `::error` + **ジョブを失敗させる**（`exit 1`） | close はこのステップの契約そのもの。失敗を握り潰すと、機能が一件も動作していなくても定期 workflow が成功し、呼び出し側が検知できない |
| ブランチ削除 | `::warning` のみ（**終了コードは 0 のまま**） | 後片付け。削除保護 ruleset で弾かれても PR は閉じており機能の目的は達成されている。それだけで日次更新を赤くするのは割に合わない |

ref の削除は `gh api --method DELETE repos/{owner}/{repo}/git/refs/heads/{branch}` で行う。
ブランチ名のスラッシュ（`chore/skills-update-YYYYMMDD`）はそのまま解決され、URL エンコードは
不要である（2026-08-17 に使い捨てブランチで実測。存在しない ref への DELETE は HTTP 422 /
終了コード 1 を返すことも実測済みで、成否判定が成立する）。

#### 取得件数の上限

`gh pr list` は `--limit 1000` で取得し、上限に達した場合は `::warning` を出す。完全な
ページネーションは行わない。取りこぼしは警告で必ず可視化されて沈黙せず、`--base` により母集団が
「特定 base の open PR」に限定されるため、1000 件超は現実的な運用範囲の外にある。上限 +
打ち切り警告のほうが、無制限ページネーションより API 消費が予測可能である。

**既定を `'false'`（無効）にしている理由**: 下流 17 リポは wrapper から本 workflow を呼ぶだけの
構成であり、既定を有効にすると wrapper を 1 行も触っていないリポジトリでも次回の定期実行から
PR の自動 close が始まる。close は取り消しの効く操作とはいえ、各リポジトリのオーナーが
知らないうちに open PR が消える挙動を既定にはしない。有効化は wrapper へ明示的に
`submodule-close-superseded: 'true'` / `skills-close-superseded: 'true'` を書いた
リポジトリだけに限る（オプトイン）。

実装は composite action ではなく本 reusable workflow のジョブステップに置いている。理由は
`.github/workflows/update-external.yml` の当該ステップの注記を参照（composite action は
本 workflow から別 SHA で pin されており、`action.yml` を編集しても pin を上げるまで実行内容が
変わらない。加えて未知の input は警告のみで job が緑のまま素通りするため、「緑なのに機能しない」
状態を作りやすい）。

なお本ステップは `jq` を必須とする。不在時は先頭のガードが `::error` を出して失敗する
（黙って「対象なし」で緑終了すると、有効化したつもりで 1 件も閉じない状態に気付けないため）。

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

## 参照バージョン（`@latest`）

wrapper は `uses: Fandhe-AI/actions/.github/workflows/update-external.yml@latest` を参照する。
`latest` は main への push ごとに本リポジトリの `.github/workflows/move-latest-tag.yml` が
付け替えるため、呼び出し側での更新作業は発生しない（2026-08-18・オーナー判断で SHA pin から
移行）。

移行前は wrapper の `@<SHA>` を手で更新する必要があり、タグ・リリースが 1 件も無いため
Dependabot にも任せられなかった。`latest` の導入でこの運用課題は解消している。

トレードオフとして、main の更新は次回起動時に全呼び出し側へ即時反映される。upstream の
`workflow_call` inputs を破壊的に変更すると全リポジトリの同期ジョブが起動時に失敗する
（`Invalid input, <name> is not defined in the referenced workflow`）ため、inputs の削除・
改名は互換を保って行う。

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
