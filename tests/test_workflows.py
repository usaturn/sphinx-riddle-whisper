"""GitHub Actions workflow の構成検証テスト。

CI 充実化 Spec（2026-07-04）の要点 — 全アクションの SHA ピン留め・
最小 permissions・uv audit の必須化（continue-on-error 禁止）・
統合 ci.yml の 4 ジョブ構成 — を回帰テストとして固定する。
"""

import re
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
WORKFLOWS_DIR: Path = REPO_ROOT / ".github" / "workflows"

# owner/repo@<40桁SHA> 形式（ローカル参照 ./ は対象外）
_SHA_PINNED = re.compile(r"^[^/@]+/[^@]+@[0-9a-f]{40}$")


def _load(path: Path) -> dict[str, Any]:
    """workflow YAML を dict として読む。"""
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _iter_steps(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """全ジョブの steps を平坦化して返す。"""
    steps: list[dict[str, Any]] = []
    for job in workflow.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def test_旧workflowが削除されciymlが存在する() -> None:
    """test-matrix.yml / check-documents.yml は ci.yml へ統合済みで存在しない。"""
    assert (WORKFLOWS_DIR / "ci.yml").exists()
    assert not (WORKFLOWS_DIR / "test-matrix.yml").exists()
    assert not (WORKFLOWS_DIR / "check-documents.yml").exists()


def test_全workflowのusesがSHAピン留めされている() -> None:
    """サプライチェーン対策: 全アクション参照が 40 桁コミット SHA 固定である。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            uses = step.get("uses")
            if uses is None:
                continue
            assert _SHA_PINNED.match(uses), (
                f"{path.name}: '{uses}' が SHA ピン留めされていない"
            )


def test_ciymlは4ジョブとconcurrencyと最小permissionsを持つ() -> None:
    """統合 CI は lint/test/docs/audit-and-package の並列 4 ジョブ構成である。"""
    ci = _load(WORKFLOWS_DIR / "ci.yml")
    assert set(ci["jobs"]) == {"lint", "test", "docs", "audit-and-package"}
    assert "concurrency" in ci
    assert ci["permissions"] == {"contents": "read"}


def test_uv_auditにcontinue_on_errorが無い() -> None:
    """uv audit は必須ゲート。advisory（continue-on-error）へ戻る回帰を防ぐ。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            if "uv audit" in step.get("run", ""):
                assert "continue-on-error" not in step, (
                    f"{path.name}: uv audit が advisory に戻っている"
                )


def test_全checkoutでpersist_credentialsがfalse() -> None:
    """artipacked 対策: checkout はクレデンシャルを残さない。"""
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for step in _iter_steps(_load(path)):
            uses = step.get("uses", "")
            if uses.startswith("actions/checkout@"):
                assert step.get("with", {}).get("persist-credentials") is False, (
                    f"{path.name}: checkout に persist-credentials: false が無い"
                )
