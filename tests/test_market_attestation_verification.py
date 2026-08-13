from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from market_snapshot_attestation import (  # noqa: E402
    AttestationContractError,
    verify_attested_receipt,
)
from market_snapshot_receipt import PREDICATE_TYPE, canonical_json_bytes  # noqa: E402


class MarketAttestationVerificationTests(unittest.TestCase):
    def test_verified_statement_predicate_must_equal_the_local_canonical_receipt(self) -> None:
        receipt = {"receiptVersion": 1, "predicateType": PREDICATE_TYPE, "value": "可信"}
        result = [
            {
                "verificationResult": {
                    "statement": {
                        "predicateType": PREDICATE_TYPE,
                        "predicate": receipt,
                    }
                }
            }
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            receipt_path = root / "validation-receipt.json"
            result_path = root / "attestation.json"
            receipt_path.write_bytes(canonical_json_bytes(receipt))
            result_path.write_text(json.dumps(result), encoding="utf-8")

            verify_attested_receipt(result_path, receipt_path)

    def test_wrong_predicate_type_different_receipt_or_multiple_matches_fail_closed(self) -> None:
        receipt = {"receiptVersion": 1, "predicateType": PREDICATE_TYPE, "value": "本地"}
        cases = (
            [{"verificationResult": {"statement": {"predicateType": "https://invalid/v1", "predicate": receipt}}}],
            [{"verificationResult": {"statement": {"predicateType": PREDICATE_TYPE, "predicate": {**receipt, "value": "他份"}}}}],
            [
                {"verificationResult": {"statement": {"predicateType": PREDICATE_TYPE, "predicate": receipt}}},
                {"verificationResult": {"statement": {"predicateType": PREDICATE_TYPE, "predicate": receipt}}},
            ],
        )
        for result in cases:
            with self.subTest(result=result), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                receipt_path = root / "validation-receipt.json"
                result_path = root / "attestation.json"
                receipt_path.write_bytes(canonical_json_bytes(receipt))
                result_path.write_text(json.dumps(result), encoding="utf-8")
                with self.assertRaises(AttestationContractError):
                    verify_attested_receipt(result_path, receipt_path)


if __name__ == "__main__":
    unittest.main()
