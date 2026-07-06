"""定義 HTML を ``<template>`` としてページへ注入する inject モジュール。

html-page-context ハンドラ :func:`inject_definition_templates` が中心で、
ページ P が参照する各 term-id について定義 HTML を生成し、
``<template id="riddle-tip--{term-id}">`` として ``context['body']`` 末尾へ
追記する（抽出→StandardDomain 突合→collect→rebase→render→sanitize の統合）。

参照 term-id の抽出は :func:`extract_referenced_term_ids` が担う。
html-page-context に渡る解決済み doctree(P) を走査し、ページ P が参照している
term-id（'term-' プレフィックスを持つ id）を列挙する。:term: 参照は解決済み
doctree で ``nodes.reference`` になり、term-id は次の 2 形態で現れる:

- 同一ページ参照: ``ref['refid']`` に term-id が入る（refuri は None）。
- クロスページ参照: ``ref['refuri']`` のフラグメントに term-id が入る。
  singlehtml では ``#document-<docname>#term-*`` の二重フラグメント形になる
  ため、最後の '#' 区切りセグメントを term-id として扱う。

抽出は候補列挙のみで、StandardDomain との突合（glossary 用語のみ採用）は
:func:`inject_definition_templates` 側で行う。
"""

from __future__ import annotations

from collections.abc import Iterable
from html import escape as _html_escape
from typing import Any, cast
from urllib.parse import urlsplit

from docutils import nodes
from sphinx import addnodes
from sphinx.application import Sphinx
from sphinx.domains.std import StandardDomain
from sphinx.environment import BuildEnvironment

from sphinx_riddle_whisper.collect import (
    HomeDoctreeCache,
    _EnvLike,
    build_term_home_index,
    build_term_home_index_by_name,
    build_term_text_index,
    extract_definitions,
)
from sphinx_riddle_whisper.rebase import rebase_internal_references
from sphinx_riddle_whisper.render import _RenderPartialBuilder, render_definition
from sphinx_riddle_whisper.sanitize import sanitize_html

_TERM_ID_PREFIX = "term-"


def record_page_home_dependencies(app: Sphinx, env: BuildEnvironment) -> None:
    """全ページについて P→home 依存を env へ一括記録する（env-updated ハンドラ）。

    各ページ P が参照する term の home ドキュメントのソースと、home 側で記録済みの
    include 等の依存ファイルを ``env.dependencies``（Sphinx 既定の依存集合）へ
    ``note_dependency`` する。増分ビルドで home の定義や home の依存ファイルが
    変わったとき、参照ページ P を outdated と判定させて再書き出しさせるための依存である。
    これが無いと、定義は home(index 等)にあるのに注入 template は参照ページ P 側へ
    埋め込まれるため、home または home の include だけ変更した増分ビルドで P が
    再書き出しされず古い template が残存する（spec の失敗モード「増分で古い
    template 残存」）。

    **``env-updated``（読み込みフェーズ後・親プロセスで一度だけ発火）で記録する理由**:
    html-page-context は並列書き出し(parallel write)では fork されたワーカープロセスで
    発火するため、そこで ``note_dependency`` しても親プロセスの env（次ビルドへ pickle
    される実体）には反映されず依存が失われる。``env-updated`` は書き出し fork の前に
    親プロセスで発火し、ここで記録した依存は env と共に永続化されるため、逐次/並列
    いずれのビルドでも増分の再書き出しが正しく効く。

    **未解決 doctree＋用語名索引で求める（フル解決しない）理由**: 依存記録に必要なのは
    「ページ P が参照する term の home」だけで、解決時に確定する term-id は不要。未解決
    doctree（:func:`get_doctree`）には ``:term:`` が ``addnodes.pending_xref``
    （``reftype == 'term'`` の ``reftarget`` に用語名）として残っており、用語名 → home は
    ``StandardDomain.objects`` から直接引ける。よって ``get_and_resolve_doctree`` の
    post-transform 込みフル解決を行わない。本ハンドラは毎ビルド（フル/増分とも）発火する
    ため、ここで全 doc をフル解決すると増分の利点（変更 doc とその依存のみ処理）を
    打ち消してしまう（cf. 性能契約テスト）。

    ``env.dependencies`` は Sphinx 既定の依存機構（並列マージ対応済み）であり、拡張独自の
    env データ蓄積ではない。よって ``env_version`` / ``env-merge-info`` / ``env-purge-doc``
    の自前実装は不要のまま（#23 env_version 要否ゲート）。

    :param app: Sphinx アプリケーション。
    :param env: ビルド環境（``env-updated`` から渡される。``app.env`` と同一）。
    """
    # "std" ドメインは常に StandardDomain だが、env.get_domain() の戻り値は基底の
    # Domain 型（objects 属性を持たない）としてしか静的に分からないため cast する。
    std = cast(StandardDomain, env.get_domain("std"))
    home_by_name = build_term_home_index_by_name(std)
    if not home_by_name:
        return

    for pagename in env.all_docs:
        # 未解決 doctree を読む（pickle ロードのみ・post-transform なし）。
        page_doctree = env.get_doctree(pagename)
        term_names = extract_referenced_term_names(page_doctree)
        homes = {
            home_by_name[name.lower()]
            for name in term_names
            if name.lower() in home_by_name
        }
        for home in homes:
            if home == pagename:
                continue
            home_dependencies = {env.doc2path(home), *env.dependencies.get(home, ())}
            for dependency in home_dependencies:
                env.note_dependency(dependency, docname=pagename)


def extract_referenced_term_names(doctree: nodes.Element) -> list[str]:
    """未解決 doctree 内の ``:term:`` 参照（``pending_xref``）の用語名を列挙する。

    ``:term:`` ロールは未解決段階では ``addnodes.pending_xref``
    （``refdomain == 'std'`` かつ ``reftype == 'term'``）になり、``reftarget`` に
    参照対象の用語名が入る。その用語名を DISTINCT（重複排除・最初の出現順を保持）に
    列挙して返す。解決済み doctree の ``nodes.reference`` を走査する
    :func:`extract_referenced_term_ids` の未解決版で、依存記録（用語名 → home）に用いる。

    :param doctree: 未解決の doctree（``findall`` が使えるノード）。
    :returns: ``:term:`` 参照の用語名のリスト（重複排除・出現順保持）。
    """
    names: list[str] = []
    for xref in doctree.findall(addnodes.pending_xref):
        if xref.get("refdomain") != "std" or xref.get("reftype") != "term":
            continue
        target = xref.get("reftarget")
        if target:
            names.append(target)
    return list(dict.fromkeys(names))


def extract_referenced_term_ids(doctree: nodes.Element) -> list[str]:
    """解決済み doctree 内の ``nodes.reference`` を走査し term-id を列挙する。

    ``refuri`` のフラグメントと ``refid`` の双方から 'term-' で始まる id を
    DISTINCT（重複排除・最初の出現順を保持）に列挙して返す。

    :param doctree: 解決済みの doctree（``findall`` が使えるノード）。
    :returns: 'term-' で始まる term-id のリスト（重複排除・出現順保持）。
    """
    candidates: list[str] = []
    for ref in doctree.findall(nodes.reference):
        refuri = ref.get("refuri")
        if refuri:
            fragment = urlsplit(refuri).fragment
            # singlehtml では refuri が '#document-<docname>#term-*' の二重
            # フラグメント形になり、urlsplit().fragment は
            # 'document-<docname>#term-*' を返す。term-id は最後の '#' 区切り
            # セグメントに入るため、そこを取り出して判定する。
            term_id = fragment.rsplit("#", 1)[-1]
            if term_id.startswith(_TERM_ID_PREFIX):
                candidates.append(term_id)
        refid = ref.get("refid")
        if refid and refid.startswith(_TERM_ID_PREFIX):
            candidates.append(refid)
    return list(dict.fromkeys(candidates))


def _as_set(value: object) -> set[str] | None:
    """``allowed_tags`` / ``allowed_schemes`` 用に list を set へ変換する。

    ``None`` はそのまま返す（既定許可リスト使用の合図）。すでに set ならそのまま、
    list（や他の反復可能）なら set 化する。

    :param value: config 由来の許可リスト値（``None`` / set / list）。
    :returns: set へ正規化した値。``None`` のときは ``None``。
    """
    if value is None:
        return None
    if isinstance(value, set):
        return value
    return set(cast("Iterable[str]", value))


def inject_definition_templates(
    app: Sphinx,
    pagename: str,
    templatename: str,
    context: dict[str, Any],
    doctree: nodes.document | None,
) -> None:
    """html-page-context ハンドラ。定義 HTML を ``<template>`` として注入する。

    ページ P が参照する各 term-id について定義 HTML を生成し、
    ``<template id="riddle-tip--{term-id}">`` として ``context['body']`` 末尾へ
    追記する。``doctree`` が ``None``（非ドキュメントページ）なら即 return する。

    :param app: Sphinx アプリケーション。
    :param pagename: 表示ページ P のドキュメント名。
    :param templatename: 使用テンプレート名（未使用）。
    :param context: HTML テンプレートコンテキスト。``'body'`` を更新する。
    :param doctree: 解決済み doctree。非ドキュメントページでは ``None``。
    """
    if doctree is None:
        return

    # P→home 依存は env-updated ハンドラ record_page_home_dependencies が読み込み
    # フェーズ後・親プロセスで一括記録済み（並列書き出しのワーカーで note_dependency
    # が失われる問題を回避し、増分ビルドで home 変更時に P を再書き出しさせる）。

    term_ids = extract_referenced_term_ids(doctree)
    if not term_ids:
        return

    # "std" ドメインは常に StandardDomain だが、env.get_domain() の戻り値は基底の
    # Domain 型（objects 属性を持たない）としてしか静的に分からないため cast する。
    std = cast(StandardDomain, app.env.get_domain("std"))
    home_index = build_term_home_index(std)
    term_ids = [tid for tid in term_ids if tid in home_index]
    if not term_ids:
        return

    term_text_by_id = build_term_text_index(std)

    # _EnvLike は get_and_resolve_doctree(docname, builder, *, tags=...) だけを要求する
    # 構造的型（テスト用フェイクでも満たせるよう意図的に緩い）。実際の
    # BuildEnvironment はこの部分集合を満たすが、builder/tags の実引数型
    # （Builder/Tags）は Protocol 側の宣言（object）より狭いため静的な部分型判定は
    # 通らない。呼び出し方が Protocol の契約どおりであることは自明なので cast する。
    cache = HomeDoctreeCache(cast(_EnvLike, app.env), app.builder)
    defs_by_home: dict[str, dict[str, nodes.definition]] = {}

    def get_definition(term_id: str) -> nodes.definition | None:
        """term_id の definition（deepcopy 済み）を home 単位のメモ化付きで返す。"""
        home = home_index[term_id]
        if home not in defs_by_home:
            defs_by_home[home] = extract_definitions(cache.get(home))
        return defs_by_home[home].get(term_id)

    # フェーズ1（発見）: riddle_nested 有効時、レベル1定義内の :term: 参照
    # （レベル2）を追加収集する。固定2段のためレベル2定義内の参照は収集しない。
    # 発見は rebase による definition の破壊的変更前に行う（フェーズ分離で保証）。
    if app.config.riddle_nested:
        nested_ids: list[str] = []
        for term_id in term_ids:
            definition = get_definition(term_id)
            if definition is None:
                continue
            nested_ids.extend(extract_referenced_term_ids(definition))
        term_ids = list(
            dict.fromkeys(
                [*term_ids, *(tid for tid in nested_ids if tid in home_index)]
            )
        )

    allowed_tags = _as_set(app.config.riddle_allowed_tags)
    allowed_schemes = _as_set(app.config.riddle_allowed_schemes)
    allowed_attributes = app.config.riddle_allowed_attributes

    templates: list[str] = []
    for term_id in term_ids:
        home = home_index[term_id]
        # P→home の依存記録は record_page_home_dependencies が親プロセスで一括済み
        # （並列書き出しでワーカー側 note_dependency が失われる問題を回避）。
        definition = get_definition(term_id)
        if definition is None:
            continue

        # :doc:/:ref: 参照は render_partial が refuri を verbatim 出力するため
        # home 基準のまま残る → 表示ページ P 基準へ自前で再ベースする。
        rebase_internal_references(
            definition,
            home_docname=home,
            page_docname=pagename,
            builder=app.builder,
        )
        # 画像 uri は render_partial（HTML writer）が builder.images/imgpath 経由で
        # 表示ページ P 基準の '_images/<basename>' へ自動で書き換えるため、ここで
        # 自前再ベースはしない（二重再ベースは実在しない 404 パスを生む）。

        # app.builder は静的には基底の Builder 型（render_partial を持たない）だが、
        # html-page-context ハンドラが発火する時点で実体は必ず render_partial を持つ
        # HTML 系ビルダである。
        rendered = render_definition(
            cast(_RenderPartialBuilder, app.builder),
            definition,
            strip_classes=app.config.riddle_strip_classes,
            include_term_title=app.config.riddle_include_term_title,
            term_text=term_text_by_id.get(term_id),
        )
        rendered = sanitize_html(
            rendered,
            enabled=app.config.riddle_sanitize,
            allowed_tags=allowed_tags,
            allowed_attributes=allowed_attributes,
            allowed_schemes=allowed_schemes,
        )

        # 多層防御: term-id を id 属性へ生補間せず HTML エスケープする。
        # 通常の term-id はメタ文字を含まないが、万一 '"' 等が混入しても
        # 属性値が壊れて属性外へ脱出しないようにする。
        term_id_attr = _html_escape(term_id, quote=True)
        templates.append(
            f'<template id="riddle-tip--{term_id_attr}">{rendered}</template>'
        )

    if templates:
        context["body"] = context.get("body", "") + "".join(templates)
