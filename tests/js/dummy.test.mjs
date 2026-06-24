// dev-only 単体テストの雛形。jsdom が動くこと（DOM 環境）を最小確認する。
// 実際の riddle.js の単体テストは #17 以降で追加する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("jsdom で DOM 操作ができる（テスト基盤の疎通確認）", () => {
  const dom = new JSDOM('<!DOCTYPE html><body><span id="x">hi</span></body>');
  const el = dom.window.document.getElementById("x");
  assert.equal(el.textContent, "hi");
});
