"""從 CONTEXT.md 的 canonical 詞彙產生附錄 D。"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from typing import Sequence


_ENTRY_PATTERN = re.compile(r"^\*\*(?P<term>[^*\r\n]+)\*\*：[ \t]*$")
_AVOID_PATTERN = re.compile(r"^_避免使用_：(?P<avoid>.*)$")


@dataclass(frozen=True, slots=True)
class GlossaryEntry:
    """一個由 canonical 詞彙來源解析出的不可變詞條。"""

    term: str
    definition: str
    avoid: str


class GlossaryError(ValueError):
    """指出詞彙來源或產生流程的可修正錯誤。"""


def parse_context(path: Path) -> tuple[GlossaryEntry, ...]:
    """嚴格解析 CONTEXT.md 的詞彙條目，保留定義中的換行與段落。"""

    try:
        markdown = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise GlossaryError(f"{path}: 不是有效的 UTF-8") from error
    except OSError as error:
        raise GlossaryError(f"無法讀取來源檔案 {path}: {error}") from error

    entries: list[GlossaryEntry] = []
    seen_terms: set[str] = set()
    active_term: str | None = None
    active_line = 0
    definition_lines: list[str] = []

    for line_number, line in enumerate(markdown.splitlines(), start=1):
        term_match = _ENTRY_PATTERN.fullmatch(line)
        avoid_match = _AVOID_PATTERN.fullmatch(line)

        if term_match is not None:
            if active_term is not None:
                _raise_unfinished_entry(active_term, active_line, definition_lines)

            term = term_match.group("term").strip()
            if term in seen_terms:
                raise GlossaryError(f"第 {line_number} 行：重複 term：{term}")
            seen_terms.add(term)
            active_term = term
            active_line = line_number
            definition_lines = []
            continue

        if avoid_match is not None:
            if active_term is None:
                raise GlossaryError(f"第 {line_number} 行：孤立的避免使用欄位")

            definition = _definition_from_lines(active_term, active_line, definition_lines)
            avoid = avoid_match.group("avoid").strip()
            if not avoid:
                raise GlossaryError(f"第 {line_number} 行：詞彙「{active_term}」缺少避免使用內容")
            entries.append(GlossaryEntry(active_term, definition, avoid))
            active_term = None
            definition_lines = []
            continue

        if active_term is not None:
            definition_lines.append(line)

    if active_term is not None:
        _raise_unfinished_entry(active_term, active_line, definition_lines)
    if not entries:
        raise GlossaryError("沒有詞彙條目可產生附錄 D")
    return tuple(entries)


def render_glossary(entries: Sequence[GlossaryEntry]) -> str:
    """以固定臺灣繁體中文版型渲染詞彙表，回傳 UTF-8 LF 的文字內容。"""

    values = tuple(entries)
    if not values:
        raise GlossaryError("沒有詞彙條目可產生附錄 D")

    rendered_entries: list[str] = []
    seen_terms: set[str] = set()
    for entry in values:
        if not isinstance(entry, GlossaryEntry):
            raise GlossaryError("詞彙條目必須是 GlossaryEntry")
        term = entry.term.strip()
        avoid = entry.avoid.strip()
        definition = _canonical_newlines(entry.definition).strip()
        if not term:
            raise GlossaryError("詞彙條目缺少 term")
        if term in seen_terms:
            raise GlossaryError(f"重複 term：{term}")
        if not definition:
            raise GlossaryError(f"詞彙「{term}」缺少定義")
        if not avoid:
            raise GlossaryError(f"詞彙「{term}」缺少避免使用內容")
        seen_terms.add(term)
        rendered_entries.extend((f"## {term}", "", definition, "", f"**避免使用**：{avoid}"))

    header = (
        "# 附錄 D：詞彙表",
        "",
        "> **自動產生檔案。**唯一來源為根目錄的 [`CONTEXT.md`](../CONTEXT.md)；請勿手動修改本附錄，請先更新來源後重新產生。",
        "",
        "本附錄只用於統一教材中的詞彙與避免用語；它不提供即時市場判讀、投資建議或額外規則。",
        "",
    )
    return "\n".join((*header, *rendered_entries)).rstrip() + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    """執行 glossary 產生或 byte-identical 檢查，並回傳 shell exit code。"""

    _configure_utf8_stderr()
    parser = argparse.ArgumentParser(description="從 CONTEXT.md 產生附錄 D 詞彙表")
    parser.add_argument("--source", required=True, type=Path, help="canonical CONTEXT.md 路徑")
    parser.add_argument("--output", required=True, type=Path, help="附錄 D 輸出路徑")
    parser.add_argument("--check", action="store_true", help="只檢查輸出是否與重新產生結果完全相同")
    arguments = parser.parse_args(argv)

    try:
        content = render_glossary(parse_context(arguments.source))
        expected_bytes = content.encode("utf-8")
        if arguments.check:
            _check_output(arguments.output, expected_bytes)
        else:
            _write_output(arguments.output, content)
    except (GlossaryError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


def _definition_from_lines(term: str, line_number: int, lines: Sequence[str]) -> str:
    definition = "\n".join(lines).strip()
    if not definition:
        raise GlossaryError(f"第 {line_number} 行：詞彙「{term}」缺少定義")
    return definition


def _raise_unfinished_entry(term: str, line_number: int, lines: Sequence[str]) -> None:
    _definition_from_lines(term, line_number, lines)
    raise GlossaryError(f"第 {line_number} 行：詞彙「{term}」缺少避免使用欄位")


def _canonical_newlines(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n")


def _configure_utf8_stderr() -> None:
    reconfigure = getattr(sys.stderr, "reconfigure", None)
    if callable(reconfigure):
        reconfigure(encoding="utf-8")


def _check_output(output: Path, expected_bytes: bytes) -> None:
    if not output.is_file():
        raise GlossaryError(f"輸出檔案不存在：{output}")
    try:
        actual_bytes = output.read_bytes()
    except OSError as error:
        raise GlossaryError(f"無法讀取輸出檔案 {output}: {error}") from error
    if actual_bytes != expected_bytes:
        raise GlossaryError(f"輸出檔案已過期：{output}")


def _write_output(output: Path, content: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        temporary_path.replace(output)
    except OSError:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
