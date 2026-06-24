/* sphinx-riddle-whisper runtime bootstrap (auto-fires installRiddlePopover).
 *
 * 副作用グルーのみ: 純関数 initRiddle を riddle.js から import し、DOM 準備後に
 * 一度だけ実行する。ロジックは riddle.js 側の純関数（テスト済み）に集約し、本ファイルは
 * 配線だけに留める（テストからは import しない）。<script type="module"> として読み込む。
 */
import { initRiddle } from "./riddle.js";

// 直接の `document` 参照は shipped コードの no-undef を踏むため globalThis 経由で取る。
const doc = globalThis.document;
if (doc) {
  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", () => initRiddle(doc), {
      once: true,
    });
  } else {
    // module スクリプトは defer 相当だが、念のため即時実行経路も用意する。
    initRiddle(doc);
  }
}
