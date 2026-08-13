"""提供市場 Snapshot Attestation workflow 使用的固定格式小工具。"""

from __future__ import annotations

import argparse
import re
import sys


_RAW_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_PREFIXED_SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")


class AttestationContractError(ValueError):
    """Attestation workflow 收到不符合固定契約的輸入時停止後續發布。"""


def normalize_artifact_digest(value: str) -> str:
    """將 Action 或 REST API 的 SHA-256 digest 轉成 `sha256:<hex>` 格式。"""

    if not isinstance(value, str):
        raise AttestationContractError("Artifact digest 必須是字串。")
    if _RAW_SHA256_PATTERN.fullmatch(value) is not None:
        return f"sha256:{value}"
    if _PREFIXED_SHA256_PATTERN.fullmatch(value) is not None:
        return value
    raise AttestationContractError("Artifact digest 必須是小寫 SHA-256 或 sha256:SHA-256。")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="市場 Snapshot Attestation workflow helper")
    commands = parser.add_subparsers(dest="command", required=True)
    normalize = commands.add_parser("normalize-artifact-digest", help="輸出 canonical sha256:<hex> Artifact digest")
    normalize.add_argument("--value", required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """提供 shell 可安全擷取的單一 Artifact digest 正規化 CLI。"""

    try:
        args = _parse_args(argv)
        if args.command != "normalize-artifact-digest":
            raise AttestationContractError("不支援的 Attestation helper 指令。")
        sys.stdout.write(f"{normalize_artifact_digest(args.value)}\n")
        return 0
    except AttestationContractError as error:
        print(f"市場 Snapshot Attestation 契約失敗：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
