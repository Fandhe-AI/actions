// ai-review reusable workflow の schema 簡約スクリプト。
//
// 構造化出力を strict に強制する実装（Anthropic の structured outputs / xAI・OpenAI 互換
// サーバーの json_schema strict 等）は JSON Schema のサブセットしか受け付けず、数値制約
// （minimum / maximum）やメタ情報（$schema / title）を含むと要求自体を拒否することがある。
// そこで、構造（type / properties / required / enum / items / additionalProperties）と
// description だけを残した簡約版を生成して CLI / API へ渡す。
// 落としたキーワードの検証は normalize-output.mjs が同梱の契約で別途行うため、この簡約で
// gate（review_completed / ブロック対象 priority の判定）は弱まらない。
//
// 使い方: node strip-schema.mjs <schema.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node strip-schema.mjs <schema.json> <out.json>');
  process.exit(1);
}

const DROP = new Set(['$schema', 'title', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']);

const strip = node => {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP.has(k)) continue;
      // properties 直下のキーはフィールド名なので、キーワードとしては落とさない
      out[k] = k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, strip(sub)]))
        : strip(v);
    }
    return out;
  }
  return node;
};

writeFileSync(dest, JSON.stringify(strip(JSON.parse(readFileSync(src, 'utf8')))));
