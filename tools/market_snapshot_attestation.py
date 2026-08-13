"""提供市場 Snapshot Attestation workflow 使用的固定格式小工具。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

from market_snapshot_receipt import PREDICATE_TYPE, ReceiptValidationError, canonical_json_bytes


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


def verify_attested_receipt(attestation_json: Path, receipt_path: Path) -> None:
    """要求 gh 已驗證的 custom predicate 唯一且等於本地 canonical receipt。"""

    try:
        receipt_bytes = receipt_path.read_bytes()
        receipt = json.loads(receipt_bytes.decode("utf-8"))
        result = json.loads(attestation_json.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise AttestationContractError("Attestation 或 receipt 不是有效 JSON。") from error
    try:
        if canonical_json_bytes(receipt) != receipt_bytes:
            raise AttestationContractError("本地 validation receipt 不是 canonical JSON。")
    except ReceiptValidationError as error:
        raise AttestationContractError("本地 validation receipt 無法 canonical 化。") from error
    if not isinstance(result, list):
        raise AttestationContractError("gh attestation verify 輸出必須是 JSON array。")

    matches = 0
    for item in result:
        if not isinstance(item, dict):
            continue
        verification = item.get("verificationResult")
        statement = verification.get("statement") if isinstance(verification, dict) else None
        if not isinstance(statement, dict) or statement.get("predicateType") != PREDICATE_TYPE:
            continue
        if statement.get("predicate") == receipt:
            matches += 1
    if matches != 1:
        raise AttestationContractError("Attestation predicate 必須唯一且等於本地 validation receipt。")


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="市場 Snapshot Attestation workflow helper")
    commands = parser.add_subparsers(dest="command", required=True)
    normalize = commands.add_parser("normalize-artifact-digest", help="輸出 canonical sha256:<hex> Artifact digest")
    normalize.add_argument("--value", required=True)
    verify = commands.add_parser("verify-receipt-predicate", help="比對 gh 驗證結果與本地 receipt")
    verify.add_argument("--attestation-json", type=Path, required=True)
    verify.add_argument("--receipt", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """提供 shell 可安全擷取的單一 Artifact digest 正規化 CLI。"""

    try:
        args = _parse_args(argv)
        if args.command == "normalize-artifact-digest":
            sys.stdout.write(f"{normalize_artifact_digest(args.value)}\n")
        elif args.command == "verify-receipt-predicate":
            verify_attested_receipt(args.attestation_json, args.receipt)
            sys.stdout.write('{"receipt_predicate":"verified"}\n')
        else:
            raise AttestationContractError("不支援的 Attestation helper 指令。")
        return 0
    except AttestationContractError as error:
        print(f"市場 Snapshot Attestation 契約失敗：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
