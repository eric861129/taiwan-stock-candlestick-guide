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
        for output_path, svg in rendered:
            _write_utf8_atomically(output_path, svg)
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


def _write_utf8_atomically(path: Path, content: str) -> None:
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
        temporary_path.replace(path)
    except OSError:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
