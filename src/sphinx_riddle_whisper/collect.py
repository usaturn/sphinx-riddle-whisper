"""glossary 用語の term-id → home_docname 索引を構築するモジュール。

Sphinx の StandardDomain は属性 ``objects`` を持ち、その型は
``dict[tuple[str, str], tuple[str, str]]`` である。キーは ``(objtype, name)``、
値は ``(docname, labelid)`` であり、glossary 用語は ``objtype == 'term'``。
ここでの ``labelid`` が term-id となる。
"""

from __future__ import annotations

from typing import Protocol

from docutils import nodes
from sphinx import addnodes


class _StandardDomainLike(Protocol):
    """``objects`` 属性を持つ StandardDomain 互換オブジェクトの構造的型。

    実 ``StandardDomain.objects`` は読み取り専用の property のため、Protocol 側も
    読み取り専用（``@property``）として宣言し、書き込み可能属性との不一致を避ける。
    """

    @property
    def objects(self) -> dict[tuple[str, str], tuple[str, str]]: ...


class _EnvLike(Protocol):
    """``get_and_resolve_doctree`` を持つ BuildEnvironment 互換オブジェクトの構造的型。"""

    def get_and_resolve_doctree(
        self, docname: str, builder: object, *, tags: object = None
    ) -> nodes.document: ...


def build_term_home_index(std_domain: _StandardDomainLike) -> dict[str, str]:
    """term-id（labelid）から home_docname（docname）への索引を構築する。

    :param std_domain: ``objects`` 属性を持つ StandardDomain 互換オブジェクト。
    :returns: term-id をキー、home_docname を値とする dict。
        ``objtype`` が ``'term'`` 以外のエントリは除外する。
    """
    index: dict[str, str] = {}
    for (objtype, _name), (docname, labelid) in std_domain.objects.items():
        if objtype != "term":
            continue
        index[labelid] = docname
    return index


def build_term_home_index_by_name(std_domain: _StandardDomainLike) -> dict[str, str]:
    """用語名（小文字化）から home_docname（docname）への索引を構築する。

    :func:`build_term_home_index` が term-id（labelid）をキーにするのに対し、本関数は
    用語名 ``name`` をキーにする。未解決 doctree の ``:term:`` 参照
    （``addnodes.pending_xref`` の ``reftarget`` は用語名）から home を引くために用いる。
    ``:term:`` の解決はケース非依存（``StandardDomain`` の term 解決が大文字小文字を
    無視する）なので、キーは ``name.lower()`` に正規化する。

    :param std_domain: ``objects`` 属性を持つ StandardDomain 互換オブジェクト。
    :returns: 用語名（小文字化）をキー、home_docname を値とする dict。
        ``objtype`` が ``'term'`` 以外のエントリは除外する。
    """
    index: dict[str, str] = {}
    for (objtype, name), (docname, _labelid) in std_domain.objects.items():
        if objtype != "term":
            continue
        index[name.lower()] = docname
    return index


def build_term_entry_index_by_name(
    std_domain: _StandardDomainLike,
) -> dict[str, tuple[str, str]]:
    """用語名（小文字化）から (home_docname, term_id) への索引を構築する。

    :func:`build_term_home_index_by_name` が home_docname だけを返すのに対し、
    本関数は term-id（labelid）も返す。定義内 :term: 参照の推移依存記録で、
    用語名から「home の glossary 内の definition」を term-id で引くために用いる。
    キーの小文字化の理由は :func:`build_term_home_index_by_name` と同じ。

    :param std_domain: ``objects`` 属性を持つ StandardDomain 互換オブジェクト。
    :returns: 用語名（小文字化）をキー、``(home_docname, term_id)`` を値とする dict。
        ``objtype`` が ``'term'`` 以外のエントリは除外する。
    """
    index: dict[str, tuple[str, str]] = {}
    for (objtype, name), (docname, labelid) in std_domain.objects.items():
        if objtype != "term":
            continue
        index[name.lower()] = (docname, labelid)
    return index


def build_term_text_index(std_domain: _StandardDomainLike) -> dict[str, str]:
    """term-id（labelid）から用語名（name）への索引を構築する。

    :func:`build_term_home_index` と同じく ``std_domain.objects`` を走査するが、
    値として home_docname ではなく用語名 ``name`` を採る。term タイトル表示用。

    :param std_domain: ``objects`` 属性を持つ StandardDomain 互換オブジェクト。
    :returns: term-id をキー、用語名を値とする dict。
        ``objtype`` が ``'term'`` 以外のエントリは除外する。
    """
    index: dict[str, str] = {}
    for (objtype, name), (_docname, labelid) in std_domain.objects.items():
        if objtype != "term":
            continue
        index[labelid] = name
    return index


class HomeDoctreeCache:
    """home ドキュメントの解決済み doctree を home_docname 単位でメモ化するキャッシュ。

    単一ビルド内でのみ有効。同一 home_docname に対しては
    ``env.get_and_resolve_doctree`` を1回だけ呼び、以降は保存済みオブジェクトを返す。
    """

    def __init__(self, env: _EnvLike, builder: object) -> None:
        """env と builder を保持し、内部キャッシュを初期化する。

        :param env: ``get_and_resolve_doctree`` を持つ Sphinx BuildEnvironment 互換オブジェクト。
        :param builder: 解決に用いる Sphinx Builder。
        """
        self._env = env
        self._builder = builder
        self._cache: dict[str, nodes.document] = {}

    def get(self, home_docname: str) -> nodes.document:
        """home_docname の解決済み doctree をメモ化して返す。

        :param home_docname: 解決する home ドキュメントの docname。
        :returns: 解決済み doctree。同一 home_docname には毎回同一オブジェクトを返す。
        """
        if home_docname not in self._cache:
            # Sphinx 11 で必須化される ``tags`` を明示的に渡し、非推奨警告を避ける。
            # 実 Builder は ``tags`` を持つ。擬似 Builder には無いため getattr で防御する。
            tags = getattr(self._builder, "tags", None)
            self._cache[home_docname] = self._env.get_and_resolve_doctree(
                home_docname, self._builder, tags=tags
            )
        return self._cache[home_docname]


def extract_definitions(doctree: nodes.Node) -> dict[str, nodes.definition]:
    """解決済み doctree を走査し term-id → definition の deepcopy を返す。

    ``addnodes.glossary`` 配下の各 ``nodes.definition_list_item`` について、
    その直接の子の ``nodes.term`` から得た全 term-id（``term['ids']``）を、
    同 item の直接の子である ``nodes.definition`` に対応付ける。別名（複数 term）は
    同一 definition を共有するが、戻り値では term-id ごとに独立した
    ``node.deepcopy()`` を返す。

    :param doctree: 解決済み doctree（``findall`` を持つ docutils ノード）。
    :returns: term-id をキー、対応する definition の deepcopy を値とする dict。
        glossary が無ければ空 dict。
    """
    result: dict[str, nodes.definition] = {}
    for glossary in doctree.findall(addnodes.glossary):
        for dl in glossary.findall(nodes.definition_list):
            for item in dl.findall(nodes.definition_list_item):
                # ネストした定義リストの term/definition を誤って拾わないよう、
                # ``item`` の「直接の子」だけを対象にする。
                definition = next(
                    (c for c in item.children if isinstance(c, nodes.definition)),
                    None,
                )
                if definition is None:
                    continue
                for child in item.children:
                    if not isinstance(child, nodes.term):
                        continue
                    for term_id in child["ids"]:
                        # term-id ごとに独立した複製を返す（呼び出し側の改変が
                        # 別 term-id や元 doctree に波及しないようにする）。
                        result[term_id] = definition.deepcopy()
    return result
