/* sphinx-riddle-whisper glossary popover (placeholder; implemented in #17-#20) */

// TreeWalker で要素ノードだけを巡回するためのフィルタ（NodeFilter.SHOW_ELEMENT）。
const SHOW_ELEMENT = 0x1;

// 二次防御の走査で保持する許可要素（fail-closed allowlist・sanitize.py の
// DEFAULT_ALLOWED_TAGS と整合）。これ以外の要素はノードごと除去する。
// 比較キーは大文字に正規化する: HTML 要素の tagName は元から大文字だが、
// SVG 要素（例 SVGAElement）は小文字になるため toUpperCase() で揃える。
const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "HR",
  "SPAN",
  "DIV",
  "EM",
  "STRONG",
  "B",
  "I",
  "S",
  "SUB",
  "SUP",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
  "VAR",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "DL",
  "DT",
  "DD",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "CAPTION",
  "A",
  "IMG",
  "FIGURE",
  "FIGCAPTION",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

// URL を値に取る属性（危険スキーム allowlist 走査の対象）。属性名は小文字で比較する。
const URL_ATTRS = new Set(["href", "action", "formaction", "xlink:href"]);

// 許可するスキーム。これ以外（javascript:/data:/vbscript: 等）は除去する。
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// DOM 契約: 定義断片 template の id プレフィックス（id は riddle-tip--{termId}）。
const RIDDLE_TIP_ID_PREFIX = "riddle-tip--";

/**
 * トリガ矩形・ポップ寸法・ビューポート寸法から配置座標 {top,left,placement} を算出する純関数。
 * DOM に触れず純粋な算術のみで計算する（座標は数値・px 文字列化は適用側の責務）。
 * @param {object} params
 * @param {{top:number,left:number,bottom:number,right:number,width:number,height:number}} params.triggerRect トリガ矩形
 * @param {number} params.popWidth ポップ幅
 * @param {number} params.popHeight ポップ高さ
 * @param {number} params.viewportWidth ビューポート幅
 * @param {number} params.viewportHeight ビューポート高さ
 * @param {number} [params.gap] トリガとの余白（既定 8）
 * @returns {{top:number,left:number,placement:string}} 配置座標と placement（'below'|'above'）
 */
export function computePopoverPosition({
  triggerRect,
  popWidth,
  popHeight,
  viewportWidth,
  viewportHeight,
  gap = 8,
}) {
  const spaceBelow = viewportHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  const fitsBelow = spaceBelow >= popHeight + gap;
  const fitsAbove = spaceAbove >= popHeight + gap;

  let placement;
  if (fitsBelow) {
    placement = "below";
  } else if (fitsAbove) {
    placement = "above";
  } else {
    placement = spaceBelow >= spaceAbove ? "below" : "above";
  }

  const top =
    placement === "above"
      ? triggerRect.top - popHeight - gap
      : triggerRect.bottom + gap;

  let left = triggerRect.left;
  if (left + popWidth > viewportWidth - gap) {
    left = viewportWidth - popWidth - gap;
  }
  if (left < gap) {
    left = gap;
  }

  return { top, left, placement };
}

/**
 * computePopoverPosition の結果座標を要素へ適用する。
 * CSSOM プロパティ API（el.style.top / el.style.left）に `${数値}px` を書き込む。
 * setAttribute('style', …) や el.style.cssText は CSP style-src 違反になるため使わない。
 * @param {HTMLElement} el 適用対象の要素
 * @param {{top:number,left:number}} pos 配置座標
 */
export function applyPopoverPosition(el, pos) {
  el.style.top = `${pos.top}px`;
  el.style.left = `${pos.left}px`;
}

/**
 * scroll/resize による再配置を requestAnimationFrame で 1 フレーム 1 回へスロットルする
 * スケジューラを生成する。pending 中の schedule() は requestFrame を再呼び出ししない。
 * @param {object} deps
 * @param {(callback: () => void) => unknown} deps.requestFrame requestAnimationFrame 相当
 * @param {() => void} deps.reposition 再配置処理
 * @returns {() => void} schedule 関数
 */
export function createRepositionScheduler({ requestFrame, reposition }) {
  let pending = false;
  return function schedule() {
    if (pending) {
      return;
    }
    pending = true;
    requestFrame(() => {
      pending = false;
      reposition();
    });
  };
}

/**
 * href の `#` 以降を取り出して decodeURIComponent した文字列を返す（共通フラグメント抽出）。
 * `#` 無し／不正エンコードで decodeURIComponent が例外なら null。空フラグメントは "" を返す。
 * @param {string} href 例 "#id3" / "../page.html#term-0"
 * @returns {string|null} デコード済みフラグメント、抽出不可なら null
 */
function decodeHrefFragment(href) {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return null;
  }
  try {
    return decodeURIComponent(href.slice(hashIndex + 1));
  } catch {
    return null;
  }
}

/**
 * トリガ要素の href から `#term-*` フラグメントを取り出し term-id（"term-0"）を返す。
 * singlehtml の `#document-index#term-0` 形では最後の `#` セグメントを term-id とする。
 * フラグメント無し／"term-" で始まらない／不正エンコードで decodeURIComponent が例外なら null。
 * @param {string} href 例 "../index.html#term-0" / "#term-0" / "#document-index#term-0"
 * @returns {string|null} 例 "term-0"、導出不可なら null
 */
export function deriveTermId(href) {
  const decoded = decodeHrefFragment(href);
  if (decoded === null) {
    return null;
  }
  const termId = decoded.slice(decoded.lastIndexOf("#") + 1);
  return termId.startsWith("term-") ? termId : null;
}

/**
 * href の `#` 以降を取り出して fragment id を返す（脚注/引用本体の getElementById 用）。
 * `#` 無し／空フラグメント／不正エンコードで decodeURIComponent が例外なら null。
 * @param {string} href 例 "#id3" / "../page.html#cite-x"
 * @returns {string|null} 例 "id3"、導出不可なら null
 */
export function deriveFragmentId(href) {
  const decoded = decodeHrefFragment(href);
  if (decoded === null || decoded === "") {
    return null;
  }
  return decoded;
}

/**
 * URL 属性値が安全（http/https/mailto/相対/#）かを判定する（fail-closed）。
 * @param {string} value 属性値
 * @returns {boolean} 安全なら true
 */
export function isSafeUrl(value) {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return true;
  }
  // 最初の / ? # より前に : があれば、スキームを明示しているとみなす。
  const beforeSpecial = trimmed.split(/[/?#]/, 1)[0];
  if (beforeSpecial.includes(":")) {
    // スキーム宣言あり: 正規のスキームトークンかつ allowlist のもののみ許可。
    const scheme = beforeSpecial.slice(0, beforeSpecial.indexOf(":") + 1);
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(scheme)
      ? ALLOWED_SCHEMES.has(scheme.toLowerCase())
      : false;
  }
  // スキーム宣言なし＝相対 URL。base 付きで解決可否を確認する。
  try {
    new globalThis.URL(trimmed, "http://example.invalid/");
    return true;
  } catch {
    return false;
  }
}

/**
 * 許可要素の属性を浄化する（on* 除去・危険スキーム URL 除去・target=_blank への rel 付与）。
 * @param {Element} el 浄化対象の要素（破壊的に変更する）
 */
function sanitizeElementAttributes(el) {
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
    } else if (URL_ATTRS.has(name) && !isSafeUrl(attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
  if (el.getAttribute("target") === "_blank") {
    el.setAttribute("rel", "noopener noreferrer");
  }
}

/**
 * 許可外要素を、許可された子を親へ引き上げつつ取り除く（unwrap）。
 * @param {Element} el 除去対象の要素
 */
function unwrapElement(el) {
  const parent = el.parentNode;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  el.remove();
}

/**
 * contract の id（riddle-tip--{termId}）の要素を getElementById で引き、
 * HTMLTemplateElement のときだけ返す。他要素や不在なら null（fail-closed・DOM clobbering 耐性）。
 * @param {Document} doc 探索対象の document
 * @param {string} termId 例 "term-0"
 * @returns {HTMLTemplateElement|null}
 */
export function getRiddleTemplate(doc, termId) {
  const el = doc.getElementById(`${RIDDLE_TIP_ID_PREFIX}${termId}`);
  // defaultView 不在（fail-safe）でも tagName で template 判定する。
  const view = doc.defaultView;
  if (view) {
    return el instanceof view.HTMLTemplateElement ? el : null;
  }
  return el !== null && el.tagName === "TEMPLATE" ? el : null;
}

/**
 * append 前の DocumentFragment を走査し、許可外要素をノードごと除去する（fail-closed）。
 * @param {DocumentFragment} frag 走査対象（破壊的に変更する）
 * @returns {DocumentFragment} 走査済みの frag
 */
export function sanitizeFragment(frag) {
  const doc = frag.ownerDocument;
  const walker = doc.createTreeWalker(frag, SHOW_ELEMENT);
  const toRemove = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (ALLOWED_TAGS.has(node.tagName.toUpperCase())) {
      sanitizeElementAttributes(node);
    } else {
      toRemove.push(node);
    }
  }
  // 走査完了後にまとめて除去する（走査中の DOM 変更による巡回崩れを避ける）。
  for (const el of toRemove) {
    unwrapElement(el);
  }
  return frag;
}

// 画像拡張子（href がこれに一致するときだけライトボックス化する。fail-closed）。
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i;

/**
 * href が安全スキームかつ画像拡張子を指すかを判定する（fail-closed）。
 * @param {string} href トリガアンカーの href
 * @param {string} baseURI 相対 href 解決のベース（doc.baseURI）
 * @returns {boolean}
 */
export function isSafeImageHref(href, baseURI) {
  if (typeof href !== "string" || !isSafeUrl(href)) {
    return false;
  }
  let url;
  try {
    url = new globalThis.URL(href, baseURI);
  } catch {
    // baseURI が about:blank 等で相対解決に使えないときの合成ベース（isSafeUrl と同手法）。
    try {
      url = new globalThis.URL(href, "http://example.invalid/");
    } catch {
      return false;
    }
  }
  return IMAGE_EXT.test(url.pathname);
}

/**
 * トリガアンカーに img 子要素があり、href が安全な画像 URL を指す場合に href を返す。
 * img 子無し / href が null / 安全でない画像 href なら null（fail-closed）。
 * @param {Element} trigger トリガアンカー要素
 * @param {string} baseURI 相対 href 解決のベース（doc.baseURI）
 * @returns {string|null}
 */
export function resolveImageSrc(trigger, baseURI) {
  if (trigger.querySelector("img") === null) {
    return null;
  }
  const href = trigger.getAttribute("href");
  if (href === null || !isSafeImageHref(href, baseURI)) {
    return null;
  }
  return href;
}

// 委譲リスナが反応するトリガリンクのセレクタ。
// term: DOM 契約 a[href*='#term-']。singlehtml の encoded '#term-' は %23term-。
const TERM_TRIGGER_SELECTOR = "a[href*='#term-'], a[href*='%23term-']";
const FOOTNOTE_TRIGGER_SELECTOR = "a.footnote-reference, a.citation-reference";
// 画像ライトボックスのトリガセレクタ（img 子を持つ画像参照アンカー）。
const IMAGE_TRIGGER_SELECTOR = "a.image-reference[href]";

// DOM 契約: 共有ポップの class 名と、それを引くためのセレクタ。
const POPOVER_CLASS = "riddle-popover";
const POPOVER_SELECTOR = `.${POPOVER_CLASS}`;
// 共有ポップの id（aria-describedby の参照先）。id 未設定のとき付与する。
const POPOVER_ID = "riddle-popover";

/**
 * 委譲イベントの target から、指定セレクタに最も近いトリガリンクを取り出す。
 * トリガでなければ null（fail-closed）。
 * @param {Event} event 委譲イベント
 * @param {string} selector トリガ判定セレクタ（term のみ／term＋脚注）
 * @returns {Element|null} トリガ要素、該当しなければ null
 */
function findTriggerFromEvent(event, selector) {
  const trigger = event.target.closest(selector);
  // 再帰防止: ポップ配下のトリガは無視する（ポップ内リンクで別 term が再帰的に開かない）。
  if (trigger !== null && trigger.closest(POPOVER_SELECTOR) !== null) {
    return null;
  }
  if (
    trigger !== null &&
    trigger.matches(TERM_TRIGGER_SELECTOR) &&
    deriveTermId(trigger.getAttribute("href")) === null
  ) {
    return null;
  }
  return trigger;
}

/**
 * 外側クリック判定: イベント発生元がポップの外（.riddle-popover 配下でない）かを返す。
 * トリガ自身は呼び出し側で先に判定済みのため、ここではポップ内かどうかだけ見る。
 * @param {Event} event 委譲イベント
 * @returns {boolean} ポップ外なら true（＝外側クリックとして閉じてよい）
 */
function isOutsidePopover(event) {
  return event.target.closest(POPOVER_SELECTOR) === null;
}

/**
 * トリガ要素から term-id 導出 → template 取得 → clone と二次防御走査 を実行する。
 * 導出不可／template 不在なら null（fail-closed）。
 * @param {Document} doc 対象 document
 * @param {Element} trigger トリガ要素
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
function resolveTermContent(doc, trigger) {
  const termId = deriveTermId(trigger.getAttribute("href"));
  if (termId === null) {
    return null;
  }
  const template = getRiddleTemplate(doc, termId);
  if (template === null) {
    return null;
  }
  return { trigger, fragment: sanitizeFragment(template.content.cloneNode(true)) };
}

// DOM 契約: 脚注/引用本体は <aside class="footnote"|"citation" id="…"> として同一ページに存在する。
const FOOTNOTE_BODY_CLASSES = ["footnote", "citation"];

/**
 * getElementById で得た要素が脚注/引用本体（<aside class="footnote"|"citation">）かを返す。
 * 他要素や不在は false（fail-closed・DOM clobbering 耐性）。
 * @param {Element|null} el
 * @returns {boolean}
 */
function isFootnoteBody(el) {
  if (el === null || el.tagName !== "ASIDE") {
    return false;
  }
  return FOOTNOTE_BODY_CLASSES.some((cls) => el.classList.contains(cls));
}

/**
 * 脚注/引用参照トリガから、同一ページ内の本体 <aside> を引き、戻りリンク（.label）を
 * 除去した本体子ノードを clone・二次防御走査して返す。本体不在／aside でないなら null。
 * @param {Document} doc
 * @param {Element} trigger 脚注/引用参照アンカー
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
export function resolveFootnoteContent(doc, trigger) {
  const fragmentId = deriveFragmentId(trigger.getAttribute("href"));
  if (fragmentId === null) {
    return null;
  }
  const body = doc.getElementById(fragmentId);
  if (!isFootnoteBody(body)) {
    return null;
  }
  const clone = body.cloneNode(true);
  // 戻りリンク（<span class="label"> 配下の .fn-backref）はポップアップでは無意味なため除去。
  for (const label of clone.querySelectorAll(".label")) {
    label.remove();
  }
  // aside ラッパは含めず、本体子ノードだけを fragment へ移して走査する。
  const fragment = doc.createDocumentFragment();
  while (clone.firstChild) {
    fragment.appendChild(clone.firstChild);
  }
  return { trigger, fragment: sanitizeFragment(fragment) };
}

/**
 * トリガ種別（term / 脚注・引用）に応じて内容を解決する。いずれにも一致しなければ null。
 * @param {Document} doc 対象 document
 * @param {Element} trigger トリガ要素
 * @returns {{trigger: Element, fragment: DocumentFragment}|null}
 */
function handleTriggerForElement(doc, trigger) {
  if (trigger.matches(TERM_TRIGGER_SELECTOR)) {
    return resolveTermContent(doc, trigger);
  }
  if (trigger.matches(FOOTNOTE_TRIGGER_SELECTOR)) {
    return resolveFootnoteContent(doc, trigger);
  }
  return null;
}

/**
 * トリガ矩形・popover 寸法・ビューポート寸法から座標を算出し popover へ適用する。
 * defaultView 不在や getBoundingClientRect 不在では何もしない（fail-safe）。
 * @param {Document} doc 対象 document
 * @param {Element} trigger トリガ要素
 * @param {Element} popover 配置対象の popover
 */
function positionPopover(doc, trigger, popover) {
  const view = doc.defaultView;
  if (!view || typeof trigger.getBoundingClientRect !== "function") {
    return;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const pos = computePopoverPosition({
    triggerRect,
    popWidth: popover.offsetWidth,
    popHeight: popover.offsetHeight,
    viewportWidth: view.innerWidth,
    viewportHeight: view.innerHeight,
  });
  applyPopoverPosition(popover, pos);
}

/**
 * 表示中の popover に scroll/resize 追従リスナ（passive）を張り、解除関数を返す。
 * 再配置は requestAnimationFrame で 1 フレーム 1 回へスロットルする。
 * defaultView 不在や addEventListener 不在では何もせず null を返す（fail-safe）。
 * @param {Document} doc 対象 document
 * @param {Element} trigger トリガ要素
 * @param {Element} popover 追従させる popover
 * @returns {(() => void)|null} リスナ解除関数。張れなかった場合は null
 */
function attachRepositionListeners(doc, trigger, popover) {
  const view = doc.defaultView;
  if (!view || typeof view.addEventListener !== "function") {
    return null;
  }
  // jsdom には requestAnimationFrame が無いため、不在時は即時実行へフォールバック。
  const requestFrame =
    typeof view.requestAnimationFrame === "function"
      ? view.requestAnimationFrame.bind(view)
      : (callback) => callback();
  const schedule = createRepositionScheduler({
    requestFrame,
    reposition: () => positionPopover(doc, trigger, popover),
  });
  view.addEventListener("scroll", schedule, { passive: true });
  view.addEventListener("resize", schedule, { passive: true });
  return () => {
    view.removeEventListener("scroll", schedule, { passive: true });
    view.removeEventListener("resize", schedule, { passive: true });
  };
}

/**
 * 共有要素を lazy initialize する（初回は生成・append、2回目以降は既存を返す）。
 * @param {Document} doc 対象 document
 * @param {string} className 要素の class 名
 * @param {string} selector querySelector セレクタ
 * @param {(el: HTMLElement) => void} [initFn] 生成直後に要素を初期化する関数
 * @returns {Element} 共有要素
 */
function getLazyElement(doc, className, selector, initFn) {
  let el = doc.querySelector(selector);
  if (el === null) {
    el = doc.createElement("div");
    el.className = className;
    if (initFn) {
      initFn(el);
    }
    doc.body.appendChild(el);
  }
  return el;
}

/**
 * 共有 .riddle-popover（単一要素）を取得する。無ければ生成して body に append し
 * キャッシュ保持する（初期は hidden）。
 * @param {Document} doc 対象 document
 * @returns {Element} 共有 .riddle-popover 要素
 */
function getPopover(doc) {
  return getLazyElement(doc, POPOVER_CLASS, POPOVER_SELECTOR, (el) => {
    el.setAttribute("hidden", "");
  });
}

// DOM 契約: 画像ライトボックスの class 名とセレクタ。
const LIGHTBOX_CLASS = "riddle-lightbox";
const LIGHTBOX_SELECTOR = `.${LIGHTBOX_CLASS}`;

/**
 * 共有 .riddle-lightbox（単一要素）を取得する。無ければ生成して body に append し
 * 内側に <img> を持たせる（初期は hidden）。getLazyElement を通じて重複を除去。
 * @param {Document} doc 対象 document
 * @returns {Element} 共有 .riddle-lightbox 要素
 */
// 閉じるボタンのラベル（モジュール定数）。
const LIGHTBOX_CLOSE_LABEL = "閉じる";

// aria-label のフォールバック名（alt が空のとき使用）。
export const LIGHTBOX_FALLBACK_LABEL = "拡大画像";

function getLightbox(doc) {
  return getLazyElement(doc, LIGHTBOX_CLASS, LIGHTBOX_SELECTOR, (lightbox) => {
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("tabindex", "-1");
    lightbox.setAttribute("hidden", "");
    const img = doc.createElement("img");
    img.className = `${LIGHTBOX_CLASS}__img`;
    lightbox.appendChild(img);
    const closeBtn = doc.createElement("button");
    closeBtn.setAttribute("type", "button");
    closeBtn.className = `${LIGHTBOX_CLASS}__close`;
    closeBtn.setAttribute("aria-label", LIGHTBOX_CLOSE_LABEL);
    lightbox.appendChild(closeBtn);
  });
}

/**
 * 共有ライトボックスが表示中（存在し hidden でない）かを返す。
 * @param {Document} doc 対象 document
 * @returns {boolean}
 */
function isLightboxOpen(doc) {
  const lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
  return lightbox !== null && !lightbox.hasAttribute("hidden");
}

/**
 * doc.defaultView の同名メソッド（setTimeout/clearTimeout 等）を view へ bind して返す。
 * defaultView 不在（fail-safe）のときは fallback を返し、TypeError で落ちないようにする。
 * @param {Document} doc 対象 document
 * @param {string} methodName 解決するメソッド名（"setTimeout" / "clearTimeout"）
 * @param {Function} fallback defaultView 不在時に使う no-op 相当のフォールバック
 * @returns {Function} bind 済みメソッド、または fallback
 */
function resolveViewTimer(doc, methodName, fallback) {
  const view = doc.defaultView;
  return view ? view[methodName].bind(view) : fallback;
}

/**
 * document へ click 委譲リスナを1つだけ張る（リンクごとの個別リスナは登録しない）。
 * トリガ click 時に内容解決（term: template / 脚注・引用: 同一ページ本体）→
 * clone と二次防御走査 → 共有 .riddle-popover へ一括挿入して表示する。
 * @param {Document} doc 対象 document
 * @param {object} [options] トリガ種別・遅延・タイマー注入（任意）
 * @param {string} [options.trigger] 'hover'|'click'|'both'（既定 'both'）
 * @param {number} [options.openDelayMs] 開く遅延ミリ秒（既定 150）
 * @param {number} [options.closeDelayMs] 閉じる遅延ミリ秒（既定 100）
 * @param {boolean} [options.interactive] ポップ内ホバーで閉じない（既定 true）
 * @param {boolean} [options.footnotes] 脚注/引用参照もトリガ対象に含める（既定 true）
 * @param {(cb: () => void, ms: number) => unknown} [options.setTimeout] setTimeout 注入
 * @param {(id: unknown) => void} [options.clearTimeout] clearTimeout 注入
 */
export function installRiddlePopover(doc, options = {}) {
  const {
    trigger = "both",
    openDelayMs = 150,
    closeDelayMs = 100,
    interactive = true,
    footnotes = true,
    imagePopup = false,
    setTimeout: setTimer = resolveViewTimer(doc, "setTimeout", () => null),
    clearTimeout: clearTimer = resolveViewTimer(doc, "clearTimeout", () => {}),
  } = options;

  // footnotes 有効時は脚注/引用参照もトリガ対象に含める（無効なら term のみ）。
  const triggerSelector = footnotes
    ? `${TERM_TRIGGER_SELECTOR}, ${FOOTNOTE_TRIGGER_SELECTOR}`
    : TERM_TRIGGER_SELECTOR;

  // 表示中の scroll/resize 追従リスナの解除関数（多重登録・リークを避ける）。
  let detachReposition = null;
  // open/close 遅延を管理する単一のタイマー id（保留中でなければ null）。
  let pendingTimer = null;
  // interactive 用の popover ホバーリスナを多重登録しないためのフラグ。
  let popoverHoverWired = false;
  // 現在開いている popover のトリガ要素（閉じる時の aria-describedby 除去・focus 復帰用）。
  let activeTrigger = null;
  // 開いた起点が focus 系（focusin/blur 経路）か（閉じる時に focus を戻すかの判定）。
  let openedByFocus = false;
  // 現在開いている画像ライトボックスの起点トリガ（閉じる時の focus 復帰用）。
  let activeImageTrigger = null;
  // openLightbox で inert + aria-hidden を付与した body 直下要素の記録（closeLightbox で解除）。
  let inertedElements = [];
  // openLightbox で保存した documentElement の overflow 元値（closeLightbox で復元）。
  let savedOverflow = null;

  function openFromTrigger(triggerEl, fromFocus = false) {
    const result = handleTriggerForElement(doc, triggerEl);
    if (result === null) {
      return;
    }
    const popover = getPopover(doc);
    // interactive=true のとき、popover への mouseenter で保留中の close を取り消し、
    // popover からの mouseleave で改めて close を遅延予約する（ポップ内に入れば閉じない）。
    if (interactive && !popoverHoverWired) {
      popover.addEventListener("mouseenter", cancelTimer);
      popover.addEventListener("mouseleave", scheduleClose);
      popoverHoverWired = true;
    }
    popover.replaceChildren(result.fragment);
    // a11y: 開く時に role='tooltip' を付与し、参照用の id を確保して、
    // トリガへ aria-describedby=popover.id を設定する（共有ポップに id を与える）。
    popover.setAttribute("role", "tooltip");
    // id 未設定（null）または空文字なら既定 id を与えてから参照する。
    const popoverId = popover.getAttribute("id") || POPOVER_ID;
    popover.setAttribute("id", popoverId);
    result.trigger.setAttribute("aria-describedby", popoverId);
    // 閉じる時の aria-describedby 除去・focus 復帰のため、起点とトリガを記録する。
    activeTrigger = result.trigger;
    openedByFocus = fromFocus;
    popover.removeAttribute("hidden");
    // 配置で例外が起きても握り潰し、配置だけスキップして表示の後続
    // （追従リスナ登録）まで継続する（fail-safe）。
    try {
      positionPopover(doc, result.trigger, popover);
    } catch {
      // 配置失敗は無視する（表示は止めない）。
    }

    // 既存の追従リスナがあれば解除してから張り直す（多重登録回避）。
    if (detachReposition !== null) {
      detachReposition();
    }
    detachReposition = attachRepositionListeners(doc, result.trigger, popover);
  }

  function closePopover() {
    const popover = doc.querySelector(POPOVER_SELECTOR);
    if (popover !== null) {
      popover.setAttribute("hidden", "");
    }
    // a11y: 閉じる時に aria-describedby を除去し、focus 起点で開いていた場合のみ
    // トリガ要素へ focus を戻す（hover 起点では戻さない）。
    if (activeTrigger !== null) {
      const triggerToRestore = activeTrigger;
      const wasFocusOpen = openedByFocus;
      activeTrigger = null;
      openedByFocus = false;
      triggerToRestore.removeAttribute("aria-describedby");
      if (wasFocusOpen && typeof triggerToRestore.focus === "function") {
        triggerToRestore.focus();
      }
    }
  }

  function openLightbox(triggerEl, src) {
    // Lazy init：既存ライトボックスなら no-op、初回のみ生成して body に append。
    // 戻り値の lightbox を起点に内部要素を引き、重複 querySelector を避ける。
    const lightbox = getLightbox(doc);
    const img = lightbox.querySelector("img");
    // src は resolveImageSrc が isSafeImageHref で検証済みなため、
    // プロパティ代入で直接 src に設定できる（innerHTML 不使用）。
    img.src = src;
    // トリガアンカー内の img 要素から alt を取得し、ライトボックスのアクセス情報に設定。
    const innerImg = triggerEl.querySelector("img");
    const alt = innerImg !== null ? innerImg.getAttribute("alt") || "" : "";
    img.alt = alt;
    // ライトボックスの aria-label を alt に同期（空 alt は非空フォールバック名）。
    lightbox.setAttribute("aria-label", alt !== "" ? alt : LIGHTBOX_FALLBACK_LABEL);
    // 閉じる時の focus 復帰用にトリガを保存。
    activeImageTrigger = triggerEl;
    // focus trap: lightbox 以外の body 直下要素に inert + aria-hidden を付与し記録する。
    // 事前に inert が付いている要素は触らない（closeLightbox で解除しない）。
    inertedElements = [];
    const bodyChildren = Array.from(doc.body.children);
    for (const child of bodyChildren) {
      if (child === lightbox) {
        continue;
      }
      if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        child.setAttribute("aria-hidden", "true");
        inertedElements.push(child);
      }
    }
    // scroll-lock: overflow を保存して hidden に設定。
    savedOverflow = doc.documentElement.style.overflow;
    doc.documentElement.style.overflow = "hidden";
    lightbox.removeAttribute("hidden");
    // 閉じるボタンへ focus を移動（ライトボックス自身ではなく）。
    const closeBtn = lightbox.querySelector(`.${LIGHTBOX_CLASS}__close`);
    if (closeBtn !== null && typeof closeBtn.focus === "function") {
      closeBtn.focus();
    } else if (typeof lightbox.focus === "function") {
      lightbox.focus();
    }
  }

  /**
   * ライトボックスを閉じる。hidden 付与に加え、openLightbox で付与した inert/aria-hidden の
   * 解除・documentElement.style.overflow の復元・開いたトリガへの focus 復帰を行う。
   * 画面クリック・ESC キーの click/keydown 委譲リスナから呼ばれる。
   */
  function closeLightbox() {
    const lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
    if (lightbox !== null) {
      lightbox.setAttribute("hidden", "");
    }
    // focus trap 解除: openLightbox で inert を付与した要素のみ解除する。
    for (const el of inertedElements) {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
    inertedElements = [];
    // scroll-lock 解除: 保存した overflow 元値へ復元。
    if (savedOverflow !== null) {
      doc.documentElement.style.overflow = savedOverflow;
      savedOverflow = null;
    }
    // ライトボックスを開いたトリガへ focus を復帰させる。
    if (activeImageTrigger !== null) {
      const toRestore = activeImageTrigger;
      activeImageTrigger = null;
      if (typeof toRestore.focus === "function") {
        toRestore.focus();
      }
    }
  }

  // open/close 遅延は単一タイマーで管理する。新しいイベントが来たら
  // 既存の保留タイマーを clearTimeout してから張り直す（連打競合・リーク防止）。
  // これにより open と close のタイマーが同時に二重起動しない。
  function scheduleTimer(action, delayMs) {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
    }
    pendingTimer = setTimer(() => {
      pendingTimer = null;
      action();
    }, delayMs);
  }

  // 保留中タイマーを取り消す（interactive: popover への mouseenter で close を打ち消す）。
  function cancelTimer() {
    if (pendingTimer !== null) {
      clearTimer(pendingTimer);
      pendingTimer = null;
    }
  }

  // 開く遅延予約の共通形。fromFocus で「focus 起点か」を記録し、閉じる時の
  // focus 復帰可否を分岐させる（pointer 起点 false / focus 起点 true）。
  function scheduleOpen(triggerEl, fromFocus = false) {
    scheduleTimer(() => openFromTrigger(triggerEl, fromFocus), openDelayMs);
  }

  function scheduleClose() {
    scheduleTimer(closePopover, closeDelayMs);
  }

  // 委譲リスナ共通形: event からトリガを取り出し、トリガなら handle(triggerEl) を呼ぶ。
  // capture=true は mouseenter/blur のように bubbles:false なイベントを拾うため。
  function addTriggerListener(type, handle, capture = false) {
    doc.addEventListener(
      type,
      (event) => {
        const triggerEl = findTriggerFromEvent(event, triggerSelector);
        if (triggerEl !== null) {
          handle(triggerEl);
        }
      },
      capture,
    );
  }

  // トリガ種別から hover/click それぞれで開くかを判定する（'both' は両方）。
  const openOnClick = trigger === "click" || trigger === "both";
  const openOnHover = trigger === "hover" || trigger === "both";

  // document への click 委譲は 1 つだけ張る: トリガ click なら開き（click/both 種別時）、
  // ポップ／トリガ外の外側クリックなら閉じる。
  doc.addEventListener("click", (event) => {
    // 画像ライトボックス（先頭で判定・早期 return で脱出）。
    // href が非画像なら preventDefault せず通常遷移へ委ねる（fail-closed）。
    if (imagePopup) {
      // 表示中はいかなるクリックも閉じ経路へ（open 経路には到達させない）。
      if (isLightboxOpen(doc)) {
        closeLightbox();
        return;
      }
      const imageTrigger = event.target.closest(IMAGE_TRIGGER_SELECTOR);
      if (imageTrigger !== null && imageTrigger.closest(LIGHTBOX_SELECTOR) === null) {
        const src = resolveImageSrc(imageTrigger, doc.baseURI);
        if (src !== null) {
          event.preventDefault();
          openLightbox(imageTrigger, src);
          return;
        }
      }
    }

    // 脚注・用語トリガ。
    const triggerEl = findTriggerFromEvent(event, triggerSelector);
    if (triggerEl !== null) {
      if (openOnClick) {
        openFromTrigger(triggerEl);
      }
      return;
    }

    // トリガでもポップ内でもない外側クリックなら閉じる。
    if (isOutsidePopover(event)) {
      closePopover();
    }
  });

  // Esc キーで閉じる（document への keydown 委譲・key==='Escape'）。
  // Tab/Shift+Tab はライトボックス表示中に focus trap を適用。
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePopover();
      if (imagePopup) {
        closeLightbox();
      }
    } else if (event.key === "Tab" && imagePopup && isLightboxOpen(doc)) {
      event.preventDefault();
      const lightbox = doc.querySelector(LIGHTBOX_SELECTOR);
      const closeBtn =
        lightbox !== null
          ? lightbox.querySelector(`.${LIGHTBOX_CLASS}__close`)
          : null;
      if (closeBtn !== null && typeof closeBtn.focus === "function") {
        closeBtn.focus();
      }
    }
  });

  if (openOnHover) {
    // mouseenter/blur は bubbles:false のため capture フェーズの委譲で拾う。
    // focusin/blur でも mouseenter/mouseleave と同一の開閉遷移を行う。
    addTriggerListener("mouseenter", scheduleOpen, true);
    addTriggerListener("mouseleave", scheduleClose, true);
    addTriggerListener(
      "focusin",
      (triggerEl) => scheduleOpen(triggerEl, true),
      true,
    );
    addTriggerListener("blur", scheduleClose, true);
  }
}

// DOM 契約: ビルド時に注入される JSON 設定要素の id（<script type="application/json">）。
export const RIDDLE_CONFIG_ID = "riddle-config";

// 設定の既定値（設定要素の不在・不正時の fail-closed フォールバック）。
// Python 側 config.py の既定値と整合させる。
const CONFIG_DEFAULTS = Object.freeze({
  trigger: "both",
  openDelayMs: 150,
  closeDelayMs: 100,
  interactive: true,
  maxHeight: "24rem",
  maxWidth: "32rem",
  footnotes: true,
  imagePopup: true,
});

// trigger に許可される値（これ以外は既定へ正規化する）。
const ALLOWED_TRIGGERS = new Set(["hover", "click", "both"]);

/**
 * 値が 0 以上の整数ならその値を、そうでなければ fallback を返す。
 * @param {unknown} value 検査値
 * @param {number} fallback 既定値
 * @returns {number}
 */
function normalizeNonNegativeInt(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * 値が boolean ならその値を、そうでなければ fallback を返す。
 * @param {unknown} value 検査値
 * @param {boolean} fallback 既定値
 * @returns {boolean}
 */
function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 値が string ならその値を、そうでなければ fallback を返す。
 * @param {unknown} value 検査値
 * @param {string} fallback 既定値
 * @returns {string}
 */
function normalizeString(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

/**
 * #riddle-config（JSON 設定要素）を読み取り、正規化した設定オブジェクトを返す。
 * 要素不在・非 script 要素（DOM clobbering）・JSON パース失敗・型不一致はいずれも
 * 既定値へ fallback する（fail-closed）。各フィールドも個別に再正規化する（多層防御。
 * Python 側 validate_config の二重化）。
 * @param {Document} doc 対象 document
 * @returns {{trigger:string, openDelayMs:number, closeDelayMs:number, interactive:boolean, maxHeight:string, maxWidth:string}}
 */
export function readRiddleConfig(doc) {
  const el = doc.getElementById(RIDDLE_CONFIG_ID);
  // clobbering 耐性: getElementById が script 以外を返したら既定（fail-closed）。
  if (el === null || el.tagName !== "SCRIPT") {
    return { ...CONFIG_DEFAULTS };
  }
  let raw;
  try {
    raw = JSON.parse(el.textContent);
  } catch {
    return { ...CONFIG_DEFAULTS };
  }
  if (raw === null || typeof raw !== "object") {
    return { ...CONFIG_DEFAULTS };
  }
  return {
    trigger: ALLOWED_TRIGGERS.has(raw.trigger)
      ? raw.trigger
      : CONFIG_DEFAULTS.trigger,
    openDelayMs: normalizeNonNegativeInt(
      raw.openDelayMs,
      CONFIG_DEFAULTS.openDelayMs,
    ),
    closeDelayMs: normalizeNonNegativeInt(
      raw.closeDelayMs,
      CONFIG_DEFAULTS.closeDelayMs,
    ),
    interactive: normalizeBoolean(
      raw.interactive,
      CONFIG_DEFAULTS.interactive,
    ),
    maxHeight: normalizeString(raw.maxHeight, CONFIG_DEFAULTS.maxHeight),
    maxWidth: normalizeString(raw.maxWidth, CONFIG_DEFAULTS.maxWidth),
    footnotes: normalizeBoolean(raw.footnotes, CONFIG_DEFAULTS.footnotes),
    imagePopup: normalizeBoolean(raw.imagePopup, CONFIG_DEFAULTS.imagePopup),
  };
}

/**
 * max-height / max-width を CSS 変数として documentElement へ設定する。
 * CSSOM プロパティ API（setProperty）のみを使い、テキスト（<style>）注入はしない
 * （CSS インジェクション面を作らない）。空文字・非 string はスキップする。
 * @param {Document} doc 対象 document
 * @param {{maxHeight?:string, maxWidth?:string}} cfg max-height/max-width を含む設定
 */
export function applyRiddleCssVars(doc, { maxHeight, maxWidth } = {}) {
  const root = doc.documentElement;
  if (!root || !root.style) {
    return;
  }
  if (typeof maxHeight === "string" && maxHeight) {
    root.style.setProperty("--riddle-max-height", maxHeight);
  }
  if (typeof maxWidth === "string" && maxWidth) {
    root.style.setProperty("--riddle-max-width", maxWidth);
  }
}

/**
 * ランタイム初期化（発動）。設定読取 → CSS 変数適用 → 委譲リスナ登録を行う。
 * @param {Document} doc 対象 document
 * @returns {object} 適用した設定オブジェクト（テスト・デバッグ用）
 */
export function initRiddle(doc) {
  const cfg = readRiddleConfig(doc);
  applyRiddleCssVars(doc, cfg);
  // installRiddlePopover は未知キー（maxHeight/maxWidth）を無視するため cfg をそのまま渡せる。
  installRiddlePopover(doc, cfg);
  return cfg;
}
