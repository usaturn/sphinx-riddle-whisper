"""sanitize.py（ビルド時 XSS 一次防御・nh3 許可リスト）のテスト。

render 後の最終 HTML 文字列を nh3 の許可リストでサニタイズする純関数
sanitize_html を検証する。各種 XSS ベクタの除去・良性要素の保持・
enabled=False バイパスを観点ごとに確認する。
合成 HTML 文字列のみで検証し、Sphinx 依存は持ち込まない。
"""

from sphinx_riddle_whisper.sanitize import sanitize_html


def test_on系イベントハンドラ属性が除去される():
    """on* イベントハンドラ（onerror 等）を含む要素をサニタイズすると、
    出力に 'onerror' が含まれないこと（インラインイベント XSS の除去）。"""
    # Arrange: onerror 属性付きの img を含む HTML 断片を用意する
    html = '<img src="x" onerror="alert(1)">'

    # Act: 既定の許可リストでサニタイズする
    result = sanitize_html(html)

    # Assert: onerror 属性が出力から除去されている
    assert "onerror" not in result


def test_javascriptスキームのhrefが除去される():
    """``javascript:`` スキームの href を持つアンカーをサニタイズすると、
    出力に 'javascript:' が含まれないこと（スキームベース XSS の除去）。"""
    # Arrange: javascript: スキームの href を持つ a を含む HTML 断片を用意する
    html = '<a href="javascript:alert(1)">x</a>'

    # Act: 既定の許可リストでサニタイズする
    result = sanitize_html(html)

    # Assert: javascript: スキームが出力から除去されている
    assert "javascript:" not in result


def test_安全な画像dataスキームのimg_srcが保持される():
    """安全な画像 ``data:`` URI（``data:image/png;base64,...``）の img(src) は
    保持される（安全な画像 data URI の許可）。最終出力に元の data: URI が
    src として残ること。"""
    # Arrange: data:image/png の base64 を src に持つ img を用意する
    html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="a">'

    # Act: 既定の許可リストでサニタイズする
    result = sanitize_html(html)

    # Assert: 安全な画像 data: URI が src として保持されている
    assert 'src="data:image/png;base64,iVBORw0KGgo="' in result


def test_jpeg_gif_webpの画像dataスキームのimg_srcが保持される():
    """data:image/jpeg・gif・webp の img(src) も png と同様に保持される
    （許可サブタイプ群をテーブル駆動で検証）。"""
    # Arrange: 許可される画像 MIME サブタイプの data: URI を列挙する
    payloads = {
        "image/jpeg": "data:image/jpeg;base64,/9j/4AAQ=",
        "image/gif": "data:image/gif;base64,R0lGODlh=",
        "image/webp": "data:image/webp;base64,UklGRh==",
    }

    for mime, uri in payloads.items():
        # Act: 各サブタイプの img をサニタイズする
        result = sanitize_html(f'<img src="{uri}" alt="a">')

        # Assert: data: URI が src として保持されている
        assert f'src="{uri}"' in result, f"{mime} の src が保持されていない"


def test_画像MIME接頭辞偽装のdataスキームsrcは除去される():
    """``data:image/pngX`` や ``data:imagex/png`` のような MIME 接頭辞偽装は、
    許可サブタイプへの完全一致／区切り境界を満たさないため除去される
    （startswith による接頭辞一致の取り違え防止・fail-closed）。"""
    # Arrange: 許可 MIME を接頭辞に含むが境界が不正な偽装 data: URI を用意する
    spoof_suffix = '<img src="data:image/pngX,AAAA" alt="a">'
    spoof_prefix = '<img src="data:imagex/png,AAAA" alt="b">'

    # Act: それぞれサニタイズする
    suffix_result = sanitize_html(spoof_suffix)
    prefix_result = sanitize_html(spoof_prefix)

    # Assert: 偽装 data: URI の src は除去されている（alt は残る）
    assert "data:" not in suffix_result
    assert 'alt="a"' in suffix_result
    assert "data:" not in prefix_result
    assert 'alt="b"' in prefix_result


def test_dataスキームのsvg_xml画像srcが除去される():
    """data:image/svg+xml の img(src) は除去される（onload 等のスクリプト
    混入 XSS を fail-closed で遮断）。src ごと、またはタグごと除去され、
    出力に 'svg+xml' / 'onload' / 'alert' のいずれも残らないこと。"""
    # Arrange: svg+xml の data: URI を src に持つ img（onload 付き）を用意する
    html = '<img src="data:image/svg+xml,<svg onload=alert(1)>">'

    # Act: 既定の許可リストでサニタイズする
    result = sanitize_html(html)

    # Assert: 危険な svg+xml data: の src が出力から除去されている
    assert "svg+xml" not in result
    assert "data:image/svg" not in result
    assert "onload" not in result
    assert "alert" not in result


def test_allowed_schemesでdataを許可してもsvg_xmlのsrcは除去される():
    """allowed_schemes を上書きして data を許可しても、独立ガードにより
    data:image/svg+xml の img(src) は依然として除去される。ユーザ設定で
    ガードを上書きできないこと（fail-closed の保証）。"""
    # Arrange: data を許可スキームに含めた上で、svg+xml の data: URI を
    # src に持つ img（onload 付き）を用意する
    html = '<img src="data:image/svg+xml,<svg onload=alert(1)>">'

    # Act: data を許可した allowed_schemes でサニタイズする
    result = sanitize_html(
        html, allowed_schemes={"http", "https", "mailto", "data"}
    )

    # Assert: ユーザが data を許可しても svg+xml の src は除去されている
    assert "svg+xml" not in result
    assert "data:image/svg" not in result
    assert "onload" not in result
    assert "alert" not in result


def test_非画像dataスキームがimg_srcでもa_hrefでも除去される():
    """非画像の ``data:`` URI（``data:text/html`` 等）は、img の src でも
    a の href でも除去される（fail-closed）。MIME が image/* でない data:
    はスクリプト実行ベクタになりうるため、出力に 'data:text/html' /
    'data:' / 'alert' のいずれも残らないこと。"""
    # Arrange: data:text/html を src に持つ img と href に持つ a を用意する
    img_html = '<img src="data:text/html,<script>alert(1)</script>" alt="a">'
    a_html = '<a href="data:text/html,<script>alert(1)</script>">x</a>'

    # Act: 既定の許可リストでサニタイズする
    img_result = sanitize_html(img_html)
    a_result = sanitize_html(a_html)

    # Assert: img の src からも a の href からも非画像 data: が除去されている
    assert "data:text/html" not in img_result
    assert "data:" not in img_result
    assert "alert" not in img_result
    assert "data:text/html" not in a_result
    assert "data:" not in a_result
    assert "alert" not in a_result


def test_custom属性data上のdataスキームは許可リストを広げても除去される():
    """ユーザーが custom tag/attribute として object[data] を許可しても、
    data: URI は除去される。data: は安全な画像 img[src] にだけ限定する。"""
    html = '<object data="data:text/html,<script>alert(1)</script>">fallback</object>'

    result = sanitize_html(
        html,
        allowed_tags={"object"},
        allowed_attributes={"object": {"data"}},
    )

    assert "data:text/html" not in result
    assert "data:" not in result
    assert "alert" not in result


def test_objectのcustom許可URL属性codebase_archive_classid上のdataスキーム候補は属性ごと除去される():
    """object[codebase|archive|classid] を個別許可しても data:text/html は属性ごと除去される。"""
    # Arrange: object の URL-bearing custom 属性をテーブル駆動で用意する
    attrs = ("codebase", "archive", "classid")

    for attr in attrs:
        # Act: 対象属性だけを許可して data:text/html をサニタイズする
        result = sanitize_html(
            f'<object {attr}="data:text/html,<script>alert(1)</script>">fallback</object>',
            allowed_tags={"object"},
            allowed_attributes={"object": {attr}},
        )

        # Assert: 対象属性は除去され、危険ペイロードは残らず fallback は残る
        assert f"{attr}=" not in result
        assert "data:" not in result
        assert "text/html" not in result
        assert "alert" not in result
        assert "fallback" in result


def test_img_srcsetの2件目以降にある危険dataスキーム候補は属性ごと除去される():
    """img[srcset] を許可した場合でも、候補内の data: URI は srcset 属性ごと fail-closed で除去する。"""
    dangerous_uris = [
        "data:image/svg+xml,<svg onload=alert(1)>",
        "data:text/html,<script>alert(1)</script>",
    ]

    for uri in dangerous_uris:
        html = (
            '<img srcset="https://safe.example/a.png 1x, '
            f'{uri} 2x" alt="x">'
        )

        result = sanitize_html(
            html,
            allowed_tags={"img"},
            allowed_attributes={"img": {"srcset", "alt"}},
        )

        assert "srcset" not in result
        assert "data:" not in result
        assert "svg+xml" not in result
        assert "text/html" not in result
        assert "alert" not in result
        assert 'alt="x"' in result


def test_custom許可されたURL属性上のdataスキーム候補は属性ごと除去される():
    """URL-bearing な custom 属性（ping/longdesc/dynsrc）の data: 候補は fail-closed で除去する。"""
    ping_direct = sanitize_html(
        '<a href="https://safe.example" ping="data:text/html,evil">x</a>',
        allowed_tags={"a"},
        allowed_attributes={"a": {"href", "ping"}},
    )
    ping_list = sanitize_html(
        '<a href="https://safe.example" ping="https://safe.example/p data:text/html,evil">x</a>',
        allowed_tags={"a"},
        allowed_attributes={"a": {"href", "ping"}},
    )
    longdesc_result = sanitize_html(
        '<img src="https://safe.example/a.png" longdesc="data:text/html,evil" alt="x">',
        allowed_tags={"img"},
        allowed_attributes={"img": {"src", "longdesc", "alt"}},
    )
    dynsrc_result = sanitize_html(
        '<img dynsrc="data:text/html,evil" alt="x">',
        allowed_tags={"img"},
        allowed_attributes={"img": {"dynsrc", "alt"}},
    )

    assert "ping=" not in ping_direct
    assert "ping=" not in ping_list
    assert "longdesc=" not in longdesc_result
    assert "dynsrc=" not in dynsrc_result

    assert "data:" not in ping_direct
    assert "data:" not in ping_list
    assert "data:" not in longdesc_result
    assert "data:" not in dynsrc_result
    assert "text/html" not in ping_direct
    assert "text/html" not in ping_list
    assert "text/html" not in longdesc_result
    assert "text/html" not in dynsrc_result

    assert 'href="https://safe.example"' in ping_direct
    assert 'href="https://safe.example"' in ping_list
    assert ">x</a>" in ping_direct
    assert ">x</a>" in ping_list
    assert 'alt="x"' in longdesc_result
    assert 'alt="x"' in dynsrc_result


def test_ping_srcset_archiveで改行タブCR区切りの2件目data候補は属性ごと除去される():
    """ping/srcset/archive の URL リストで改行・タブ・CR 区切りでも 2 件目 data: 候補は属性ごと除去する。"""
    # Arrange: 各リスト属性の 2 件目に区切り文字経由の data: 候補を置く
    html = (
        '<a href="https://safe.example" ping="https://safe.example/p\n'
        'data:text/html,evil">x</a>'
        '<img src="https://safe.example/a.png" srcset="https://safe.example/a.png 1x\t'
        'data:text/html,evil 2x" alt="x">'
        '<object archive="https://safe.example/a.jar\rdata:text/html,evil">'
        "fallback</object>"
    )

    # Act: 対象属性を許可したうえでサニタイズする
    result = sanitize_html(
        html,
        allowed_tags={"a", "img", "object"},
        allowed_attributes={
            "a": {"href", "ping"},
            "img": {"src", "srcset", "alt"},
            "object": {"archive"},
        },
    )

    # Assert: 各属性は fail-closed で除去され、良性属性と本文は残る
    assert (
        "ping=" not in result
        and "srcset=" not in result
        and "archive=" not in result
        and "data:text/html" not in result
        and 'href="https://safe.example"' in result
        and 'src="https://safe.example/a.png"' in result
        and 'alt="x"' in result
        and "fallback" in result
    )


def test_data文字列で始まる非URL属性は保持される():
    """title/alt のような通常テキスト属性は data: で始まっても URL として block しない。"""
    result = sanitize_html(
        '<p title="data:science">x</p>'
        '<img src="https://example.test/a.png" alt="data:science" title="data:title">'
    )

    assert '<p title="data:science">x</p>' in result
    assert 'src="https://example.test/a.png"' in result
    assert 'alt="data:science"' in result
    assert 'title="data:title"' in result


def test_a_hrefの安全な画像dataスキームも除去される():
    """安全な画像 MIME であっても data: URI は img[src] 以外では除去される。"""
    result = sanitize_html('<a href="data:image/png;base64,iVBORw0KGgo=">x</a>')

    assert "data:image/png" not in result
    assert "data:" not in result
    assert ">x</a>" in result


def test_a_hrefのquery内literalカンマdata文字列はdataスキームと誤判定せず保持される():
    """https URL の query に含まれる literal ",data:" は data: スキームと誤判定せず保持する。"""
    # Arrange: query 内に ",data:" を含む安全な https リンクを用意する
    html = '<a href="https://safe.example/search?q=a,data:science">x</a>'

    # Act: 既定の許可リストでサニタイズする
    result = sanitize_html(html)

    # Assert: href は除去されずそのまま保持されている
    assert 'href="https://safe.example/search?q=a,data:science"' in result


def test_ping_archiveの単一安全URL内literalカンマdata文字列は候補区切りと誤判定せず保持される():
    """ping/archive の単一安全 URL の query に含まれる ",data:" は候補区切りと誤判定せず保持する。"""
    # Arrange: ping/archive の単一安全 URL の query に ",data:" を含める
    ping_html = '<a href="https://safe.example" ping="https://safe.example/p?q=a,data:science">x</a>'
    archive_html = (
        '<object archive="https://safe.example/a.jar?q=a,data:science">'
        "fallback</object>"
    )

    # Act: 対象属性を許可してサニタイズする
    ping_result = sanitize_html(
        ping_html,
        allowed_tags={"a"},
        allowed_attributes={"a": {"href", "ping"}},
    )
    archive_result = sanitize_html(
        archive_html,
        allowed_tags={"object"},
        allowed_attributes={"object": {"archive"}},
    )

    # Assert: ping/archive の属性値はどちらも除去されず保持されている
    assert (
        'ping="https://safe.example/p?q=a,data:science"' in ping_result
        and 'archive="https://safe.example/a.jar?q=a,data:science"' in archive_result
    )


def test_custom属性data上の難読化dataスキームも除去される():
    """C0 control や ASCII tab/newline で難読化された data: も custom 属性では除去される。"""
    uris = [
        f"{chr(1)}data:text/html,<script>alert(1)</script>",
        "da\nta:text/html,<script>alert(1)</script>",
        "da\tta:text/html,<script>alert(1)</script>",
    ]

    for uri in uris:
        result = sanitize_html(
            f'<object data="{uri}">fallback</object>',
            allowed_tags={"object"},
            allowed_attributes={"object": {"data"}},
        )

        assert "text/html" not in result
        assert "data:" not in result
        assert "alert" not in result


def test_img_src上の難読化dataスキームも安全な画像以外は除去される():
    """img[src] でも難読化された非許可 MIME の data: URI は除去される。"""
    result = sanitize_html('<img src="da\nta:image/svg+xml,<svg onload=alert(1)>" alt="x">')

    assert "svg+xml" not in result
    assert "data:" not in result
    assert "alert" not in result
    assert 'alt="x"' in result


def test_scriptタグと内容が除去される():
    """script タグとその内容が除去され、後続の良性テキストは残る。"""
    result = sanitize_html("<script>alert(1)</script>safe")

    assert "<script" not in result
    assert "alert(1)" not in result
    assert "safe" in result


def test_iframeが除去される():
    """iframe タグが除去され、後続の良性テキストは残る。"""
    result = sanitize_html('<iframe src="https://e.com"></iframe>x')

    assert "<iframe" not in result
    assert "x" in result


def test_baseタグが除去される():
    """base タグが除去され、後続の良性テキストは残る。"""
    result = sanitize_html('<base href="https://e.com">y')

    assert "<base" not in result
    assert "y" in result


def test_target_blankリンクにrelが付与される():
    """target=_blank のリンクに rel="noopener noreferrer" が付与される。"""
    result = sanitize_html('<a href="https://x.com" target="_blank">x</a>')

    assert 'rel="noopener noreferrer"' in result


def test_良性HTMLは保持される():
    """段落・リスト・class などの良性要素はサニタイズで保持される。"""
    result = sanitize_html('<p class="k">t</p><ul><li>i</li></ul>')

    assert '<p class="k">t</p>' in result
    assert "<ul><li>i</li></ul>" in result


def test_相対リンクとanchorのhrefが保持される():
    """相対 href と #anchor は切り詰められず保持される（無切り詰め回帰防止）。"""
    rel = sanitize_html('<a href="page.html">x</a>')
    anchor = sanitize_html('<a href="#sec">a</a>')

    assert 'href="page.html"' in rel
    assert 'href="#sec"' in anchor


def test_allowed_attributesにlist値のdictを渡しても動作し指定属性が保持される():
    """allowed_attributes の各値を set ではなく list で渡しても TypeError に
    ならず動作する。指定属性（href/title）は保持され、未指定属性（target）は
    除去されること（dict 値の set 正規化）。"""
    # Arrange: a の許可属性を list 値の dict で指定する
    allowed = {"a": ["href", "title"]}
    html = '<a href="https://x.com" title="t" target="_blank">x</a>'

    # Act: list 値の allowed_attributes でサニタイズする（例外が出ないこと）
    result = sanitize_html(html, allowed_attributes=allowed)

    # Assert: 指定属性は保持され、未指定属性は除去されている
    assert 'href="https://x.com"' in result
    assert 'title="t"' in result
    assert "target" not in result


def test_enabledがFalseならバイパスして入力をそのまま返す():
    """enabled=False のとき危険な入力もサニタイズせずそのまま返す（完全信頼サイト向け）。"""
    html = "<script>alert(1)</script>"

    assert sanitize_html(html, enabled=False) == html


def test_code_block_plain_text_is_not_destroyed():
    """M-1: sanitize の raw 前処理がコードブロック内の平文を破壊しないことを検証する。"""
    html = "<pre><code>img src=data:text/html,alert(1) を書かないこと</code></pre>"
    result = sanitize_html(html)
    assert "img src=data:text/html,alert(1) を書かないこと" in result


def test_text_attributes_containing_src_data_are_not_destroyed():
    """M-1 回帰: title/alt の説明文にある ``src=data:`` は属性として扱わない。"""
    html = (
        '<img alt="write src=data:text/html,evil" '
        'src="https://example.test/safe.png">'
        '<a title="write src=data:text/html,evil" href="https://example.test/">x</a>'
        '<img alt="1 > 0 src=data:text/html,evil" '
        'src="https://example.test/other.png">'
    )

    result = sanitize_html(html)

    assert 'alt="write src=data:text/html,evil"' in result
    assert 'src="https://example.test/safe.png"' in result
    assert 'title="write src=data:text/html,evil"' in result
    assert 'href="https://example.test/"' in result
    assert 'alt="1 > 0 src=data:text/html,evil"' in result
    assert 'src="https://example.test/other.png"' in result


def test_unquoted_unsafe_img_src_data_is_still_removed():
    """M-1 回帰: 実際の引用符なし img[src=data:...] は引き続き src ごと除去する。"""
    result = sanitize_html('<img src=data:text/html,evil alt="x">')

    assert "data:text/html" not in result
    assert "src=" not in result
    assert 'alt="x"' in result
