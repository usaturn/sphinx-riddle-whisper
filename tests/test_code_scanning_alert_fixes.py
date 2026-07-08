"""Regression guards for GitHub Code Scanning alert-triggering test patterns."""

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read_repo_file(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def test_code_scanning_alert_1_avoids_regex_script_tag_extraction() -> None:
    source = _read_repo_file("tests/test_assets.py")

    assert r're.findall(r"<script\b[^>]*>", html)' not in source


def test_code_scanning_alert_2_avoids_regex_script_tag_extraction() -> None:
    source = _read_repo_file("tests/test_runtime_config.py")

    assert r're.findall(r"<script\b[^>]*>", html)' not in source
