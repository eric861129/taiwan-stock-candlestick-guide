import argparse
import json
from pathlib import Path
import re
from typing import Literal
from urllib.parse import unquote, urlsplit

from book_contract import EXPECTED_CHAPTERS, FIGURE_SPEC_PATTERN, ValidationIssue, mask_fenced_code


DRAFT_MARKERS = ("T" "BD", "T" "ODO", "FIX" "ME", "PLACE" "HOLDER")

LESSON_REQUIRED_SECTIONS = (
    "學習目標",
    "先說結論",
    "精確定義與證據等級",
    "人工圖例",
    "歷史案例",
    "八步判讀",
    "練習",
    "答案與評分",
    "重點、限制與來源",
)
LAB_REQUIRED_SECTIONS = ("學習指示", "案例", "評分", "來源")
HISTORICAL_STRING_FIELDS = (
    "market",
    "symbol",
    "start",
    "end",
    "timeframe",
    "price_mode",
    "source_url",
    "checked_on",
)
CAPSTONE_PATH = "chapters/20-capstone-ten-cases.md"
CAPSTONE_SCORING_HEADING = "評分"
CAPSTONE_LEAKAGE_FIELDS = ("output", "alt_text")
CAPSTONE_LEAKAGE_TOKENS = ("result", "winner", "failed", "profit", "loss", "上漲", "下跌")

HEADING_PATTERN = re.compile(r"^(?P<level>#{1,6})[ \t]+(?P<title>.+?)\s*$", re.MULTILINE)
HEADING_LINE_PATTERN = re.compile(r"^\s*#{1,6}(?:\s|$)")
INLINE_LINK_PATTERN = re.compile(
    r"(?P<image>!)?\[(?P<label>(?:\\.|[^\]])*)\]\((?P<destination>[^)\n]+)\)"
)
DRAFT_MARKER_PATTERNS = tuple(
    (marker, re.compile(rf"(?<![A-Za-z0-9_]){re.escape(marker)}(?![A-Za-z0-9_])", re.IGNORECASE))
    for marker in DRAFT_MARKERS
)
EXPECTED_CHAPTER_KINDS = {chapter.path: chapter.kind for chapter in EXPECTED_CHAPTERS}
IGNORED_WORKSPACE_DIRECTORIES = frozenset({".cache", ".git", ".superpowers", ".worktrees"})


def _relative_path(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _line_number(markdown: str, position: int) -> int:
    return markdown.count("\n", 0, position) + 1


def _markdown_files(root: Path) -> tuple[Path, ...]:
    return tuple(
        sorted(
            (
                path
                for path in root.rglob("*")
                if path.is_file()
                and path.suffix.lower() == ".md"
                and not IGNORED_WORKSPACE_DIRECTORIES.intersection(path.relative_to(root).parts)
            ),
            key=lambda path: path.as_posix().lower(),
        )
    )


def _normalized_heading_title(match: re.Match[str]) -> str:
    return match.group("title").strip().rstrip("#").rstrip()


def _has_body_content(markdown: str, headings: list[re.Match[str]], heading_index: int) -> bool:
    heading = headings[heading_index]
    body_start = heading.end()
    body_end = len(markdown)
    current_level = len(heading.group("level"))

    for following_heading in headings[heading_index + 1 :]:
        if len(following_heading.group("level")) <= current_level:
            body_end = following_heading.start()
            break

    return any(
        line.strip() and not HEADING_LINE_PATTERN.match(line)
        for line in markdown[body_start:body_end].splitlines()
    )


def _validate_required_sections(
    markdown: str,
    required_sections: tuple[str, ...],
    relative_path: str,
    issues: list[ValidationIssue],
) -> None:
    headings = list(HEADING_PATTERN.finditer(markdown))

    for required_section in required_sections:
        matching_index = next(
            (
                index
                for index, heading in enumerate(headings)
                if len(heading.group("level")) == 2
                and _normalized_heading_title(heading) == required_section
            ),
            None,
        )

        if matching_index is None:
            issues.append(
                ValidationIssue(
                    relative_path,
                    "required-section",
                    f"缺少必要段落：{required_section}",
                )
            )
            continue

        if not _has_body_content(markdown, headings, matching_index):
            issues.append(
                ValidationIssue(
                    relative_path,
                    "required-section",
                    f"必要段落不得留白：{required_section}",
                    _line_number(markdown, headings[matching_index].start()),
                )
            )


def _link_destination(destination: str) -> str:
    trimmed_destination = destination.strip()
    if trimmed_destination.startswith("<") and ">" in trimmed_destination:
        return trimmed_destination[1 : trimmed_destination.index(">")].strip()

    return trimmed_destination.split(maxsplit=1)[0] if trimmed_destination else ""


def _is_external_link(destination: str) -> bool:
    parsed_destination = urlsplit(destination)
    return bool(parsed_destination.scheme or parsed_destination.netloc)


def _validate_markdown_links(
    source_path: Path,
    relative_path: str,
    markdown: str,
    issues: list[ValidationIssue],
) -> None:
    for match in INLINE_LINK_PATTERN.finditer(markdown):
        is_image = bool(match.group("image"))
        label = match.group("label")
        destination = _link_destination(match.group("destination"))
        line = _line_number(markdown, match.start())

        if is_image and not label.strip():
            issues.append(
                ValidationIssue(
                    relative_path,
                    "empty-image-alt-text",
                    "圖片替代文字不得為空白",
                    line,
                )
            )

        if not destination or destination.startswith("#") or _is_external_link(destination):
            continue

        target_path = unquote(urlsplit(destination).path)
        if not target_path:
            continue

        local_target = source_path.parent / target_path
        is_markdown_link = local_target.suffix.lower() in {".md", ".markdown"}
        if (is_image or is_markdown_link) and not local_target.is_file():
            issues.append(
                ValidationIssue(
                    relative_path,
                    "missing-local-link",
                    f"找不到本機連結目標：{target_path}",
                    line,
                )
            )


def _validate_figure_specs(
    markdown: str,
    relative_path: str,
    issues: list[ValidationIssue],
    figure_ids: set[str],
    figure_outputs: list[tuple[str, int, str]],
) -> None:
    for match in FIGURE_SPEC_PATTERN.finditer(markdown):
        line = _line_number(markdown, match.start())
        try:
            specification = json.loads(match.group(1))
        except json.JSONDecodeError as error:
            issues.append(
                ValidationIssue(
                    relative_path,
                    "invalid-figure-spec",
                    f"figure-spec JSON 無法解析：{error.msg}",
                    line,
                )
            )
            continue

        if not isinstance(specification, dict):
            issues.append(
                ValidationIssue(
                    relative_path,
                    "invalid-figure-spec",
                    "figure-spec 必須是 JSON 物件",
                    line,
                )
            )
            continue

        figure_id = specification.get("id")
        if not isinstance(figure_id, str) or not figure_id.strip():
            issues.append(ValidationIssue(relative_path, "missing-figure-id", "figure-spec 缺少 id", line))
        elif figure_id in figure_ids:
            issues.append(
                ValidationIssue(
                    relative_path,
                    "duplicate-figure-id",
                    f"重複的 figure-spec id：{figure_id}",
                    line,
                )
            )
        else:
            figure_ids.add(figure_id)

        if specification.get("kind") == "historical":
            for field_name in HISTORICAL_STRING_FIELDS:
                value = specification.get(field_name)
                if not isinstance(value, str) or not value.strip():
                    issues.append(
                        ValidationIssue(
                            relative_path,
                            "historical-figure-provenance",
                            f"歷史圖例缺少有效來源欄位：{field_name}",
                            line,
                        )
                    )
            if not isinstance(specification.get("corporate_actions"), list):
                issues.append(
                    ValidationIssue(
                        relative_path,
                        "historical-figure-provenance",
                        "歷史圖例的 corporate_actions 必須是陣列",
                        line,
                    )
                )

        output = specification.get("output")
        if isinstance(output, str) and output.strip().lower().split("?", maxsplit=1)[0].endswith(".svg"):
            figure_outputs.append((relative_path, line, output.strip()))


def _validate_capstone_answer_leakage(
    visible_markdown: str,
    relative_path: str,
    issues: list[ValidationIssue],
) -> None:
    """拒絕第 20 章題目區圖表 metadata 洩漏答案線索。"""

    if relative_path != CAPSTONE_PATH:
        return

    scoring_heading = next(
        (
            heading
            for heading in HEADING_PATTERN.finditer(visible_markdown)
            if len(heading.group("level")) == 2
            and _normalized_heading_title(heading) == CAPSTONE_SCORING_HEADING
        ),
        None,
    )
    if scoring_heading is None:
        return

    prompt_markdown = visible_markdown[: scoring_heading.start()]
    for match in FIGURE_SPEC_PATTERN.finditer(prompt_markdown):
        try:
            specification = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if not isinstance(specification, dict):
            continue

        for field_name in CAPSTONE_LEAKAGE_FIELDS:
            value = specification.get(field_name)
            if not isinstance(value, str):
                continue
            normalized_value = value.casefold()
            for token in CAPSTONE_LEAKAGE_TOKENS:
                if token.casefold() in normalized_value:
                    issues.append(
                        ValidationIssue(
                            relative_path,
                            "capstone-answer-leakage",
                            f"評分區前的 figure-spec 欄位 {field_name} 不得包含答案線索：{token}",
                            _line_number(visible_markdown, match.start()),
                        )
                    )


def _validate_release_completeness(
    root: Path,
    figure_outputs: list[tuple[str, int, str]],
    issues: list[ValidationIssue],
) -> None:
    required_paths = ("README.md", *(chapter.path for chapter in EXPECTED_CHAPTERS))
    for required_path in required_paths:
        if not (root / required_path).is_file():
            issues.append(
                ValidationIssue(
                    required_path,
                    "release-completeness",
                    "release 模式缺少必要檔案",
                )
            )

    for source_path, line, output in figure_outputs:
        parsed_output = urlsplit(output)
        if parsed_output.scheme or parsed_output.netloc:
            continue

        output_path = unquote(parsed_output.path)
        if output_path and not (root / output_path).is_file():
            issues.append(
                ValidationIssue(
                    source_path,
                    "missing-figure-output",
                    f"找不到 figure-spec 指定的 SVG：{output_path}",
                    line,
                )
            )


def validate_book(root: Path, mode: Literal["draft", "release"]) -> list[ValidationIssue]:
    if mode not in {"draft", "release"}:
        raise ValueError("mode 必須是 draft 或 release")

    root = root.resolve()
    issues: list[ValidationIssue] = []
    figure_ids: set[str] = set()
    figure_outputs: list[tuple[str, int, str]] = []

    for path in _markdown_files(root):
        relative_path = _relative_path(root, path)
        raw_markdown = path.read_bytes()
        try:
            markdown = raw_markdown.decode("utf-8-sig", errors="strict")
        except UnicodeDecodeError as error:
            issues.append(
                ValidationIssue(
                    relative_path,
                    "invalid-utf8",
                    "Markdown 檔案不是有效的 UTF-8",
                    raw_markdown[: error.start].count(b"\n") + 1,
                )
            )
            continue

        replacement_position = markdown.find("\uFFFD")
        if replacement_position != -1:
            issues.append(
                ValidationIssue(
                    relative_path,
                    "replacement-character",
                    "Markdown 不得包含 Unicode replacement character",
                    _line_number(markdown, replacement_position),
                )
            )

        visible_markdown = mask_fenced_code(markdown)

        for marker, marker_pattern in DRAFT_MARKER_PATTERNS:
            for marker_match in marker_pattern.finditer(visible_markdown):
                issues.append(
                    ValidationIssue(
                        relative_path,
                        "draft-marker",
                        f"不得包含草稿標記：{marker}",
                        _line_number(markdown, marker_match.start()),
                    )
                )

        chapter_kind = EXPECTED_CHAPTER_KINDS.get(relative_path)
        if chapter_kind == "lesson":
            _validate_required_sections(visible_markdown, LESSON_REQUIRED_SECTIONS, relative_path, issues)
        elif chapter_kind == "lab":
            _validate_required_sections(visible_markdown, LAB_REQUIRED_SECTIONS, relative_path, issues)

        _validate_markdown_links(path, relative_path, visible_markdown, issues)
        _validate_figure_specs(visible_markdown, relative_path, issues, figure_ids, figure_outputs)
        _validate_capstone_answer_leakage(visible_markdown, relative_path, issues)

    if mode == "release":
        _validate_release_completeness(root, figure_outputs, issues)

    return sorted(
        issues,
        key=lambda issue: (issue.path, issue.line if issue.line is not None else 0, issue.rule, issue.message),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="驗證 K 線指南 Markdown 合約")
    parser.add_argument("--root", type=Path, default=Path("."), help="書籍根目錄")
    parser.add_argument("--mode", choices=("draft", "release"), default="draft", help="驗證模式")
    arguments = parser.parse_args()

    issues = validate_book(arguments.root, arguments.mode)
    for issue in issues:
        line = issue.line if issue.line is not None else 0
        print(f"{issue.path}:{line} [{issue.rule}] {issue.message}")

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
