"""從 chapter figure-spec 註解產生原創 SVG 圖表。"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile
from typing import Sequence

from book_contract import extract_figure_specs
from chart_spec import FigureSpec, parse_figure_spec, validate_unique_figure_specs
from market_data import fetch_range
from render_chart import render_svg


def main(argv: Sequence[str] | None = None) -> int:
    """解析一個 chapter，完整渲染後才以原子替換發布所有 SVG。"""

    parser = argparse.ArgumentParser(description="產生 chapter 的 SVG 圖表")
    parser.add_argument("--chapter", required=True, help="root 下的 Markdown chapter 路徑")
    parser.add_argument("--root", required=True, help="專案根目錄")
    arguments = parser.parse_args(argv)

    try:
        root = Path(arguments.root).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("root: must be a directory")
        chapter = _chapter_path(root, arguments.chapter)
        markdown = chapter.read_text(encoding="utf-8")
        specs = tuple(parse_figure_spec(raw, chapter) for raw in extract_figure_specs(markdown))
        validate_unique_figure_specs(specs)
        rendered = tuple(_render_spec(root, spec) for spec in specs)
        _publish_rendered(rendered)
        for output_path, _ in rendered:
            print(output_path.relative_to(root).as_posix())
    except (OSError, RuntimeError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


def _chapter_path(root: Path, chapter_argument: str) -> Path:
    candidate = Path(chapter_argument)
    chapter = candidate.resolve(strict=True) if candidate.is_absolute() else (root / candidate).resolve(strict=True)
    try:
        chapter.relative_to(root)
    except ValueError as error:
        raise ValueError("chapter: must be inside root") from error
    return chapter


def _render_spec(root: Path, spec: FigureSpec) -> tuple[Path, str]:
    if spec.kind == "synthetic":
        bars = spec.bars
    else:
        if spec.market is None or spec.symbol is None or spec.start is None or spec.end is None:
            raise ValueError(f"id: historical figure {spec.id} is missing validated provenance")
        bars = fetch_range(spec.market, spec.symbol, spec.start, spec.end, root / ".cache" / "market-data")
    output_path = _output_path(root, spec.output)
    return output_path, render_svg(spec, bars)


def _output_path(root: Path, output: Path) -> Path:
    figure_root = (root / "assets" / "figures").resolve()
    output_path = (root / output).resolve()
    try:
        output_path.relative_to(figure_root)
    except ValueError as error:
        raise ValueError("output: must be inside assets/figures") from error
    return output_path


def _publish_rendered(rendered: tuple[tuple[Path, str], ...]) -> None:
    """先完成所有 staging，再發布；失敗時還原本批次已碰觸的輸出。"""
    for path, _ in rendered:
        if path.exists() and not path.is_file():
            raise OSError(f"output target is not a file: {path}")

    staged: list[tuple[Path, Path]] = []
    touched: list[tuple[Path, Path | None]] = []
    backup_paths: list[Path] = []
    try:
        for path, content in rendered:
            staged.append((path, _stage_utf8(path, content)))

        for path, staged_path in staged:
            backup_path = _backup_existing(path) if path.exists() else None
            if backup_path is not None:
                backup_paths.append(backup_path)
            touched.append((path, backup_path))
            _replace_path(staged_path, path)
    except OSError as publish_error:
        rollback_errors: list[str] = []
        for path, backup_path in reversed(touched):
            try:
                if backup_path is None:
                    if path.exists():
                        path.unlink()
                else:
                    _replace_path(backup_path, path)
            except OSError as rollback_error:
                rollback_errors.append(f"{path}: {rollback_error}")
        if rollback_errors:
            raise OSError(
                f"publish failed: {publish_error}; rollback failed: {'; '.join(rollback_errors)}"
            ) from publish_error
        raise
    finally:
        for _, staged_path in staged:
            if staged_path.exists():
                staged_path.unlink()
        for backup_path in backup_paths:
            if backup_path.exists():
                backup_path.unlink()


def _stage_utf8(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        return temporary_path
    except OSError:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
        raise


def _backup_existing(path: Path) -> Path:
    with NamedTemporaryFile(
        mode="wb",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".bak",
        delete=False,
    ) as backup_file:
        backup_path = Path(backup_file.name)
    try:
        _replace_path(path, backup_path)
    except OSError:
        if backup_path.exists():
            backup_path.unlink()
        raise
    return backup_path


def _replace_path(source: Path, destination: Path) -> None:
    source.replace(destination)


if __name__ == "__main__":
    raise SystemExit(main())
