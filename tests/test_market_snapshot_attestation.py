"""市場 Snapshot Attestation workflow helper 的單元測試。"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from market_snapshot_attestation import AttestationContractError, normalize_artifact_digest  # noqa: E402


class MarketSnapshotAttestationTests(unittest.TestCase):
    """鎖住 upload-artifact 與 REST API digest 格式的正規化邊界。"""

    def test_normalizes_upload_action_and_rest_api_digest_formats_to_the_same_value(self) -> None:
        """upload-artifact 的純 hex 與 REST API 的 sha256:hex 都輸出 canonical 值。"""

        digest = "a" * 64

        self.assertEqual(f"sha256:{digest}", normalize_artifact_digest(digest))
        self.assertEqual(f"sha256:{digest}", normalize_artifact_digest(f"sha256:{digest}"))

    def test_rejects_noncanonical_or_non_sha256_artifact_digest(self) -> None:
        """未知格式不能在 workflow output 被誤當成可用 provenance。"""

        for value in ("A" * 64, "sha512:" + "a" * 64, "sha256:" + "a" * 63, " sha256:" + "a" * 64):
            with self.subTest(value=value):
                with self.assertRaisesRegex(AttestationContractError, "Artifact digest"):
                    normalize_artifact_digest(value)

    def test_cli_emits_only_the_canonical_digest(self) -> None:
        """workflow 可直接擷取 CLI stdout，且不混入診斷文字。"""

        digest = "b" * 64
        completed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "market_snapshot_attestation.py"),
                "normalize-artifact-digest",
                "--value",
                digest,
            ],
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual(f"sha256:{digest}\n", completed.stdout)
        self.assertEqual("", completed.stderr)


if __name__ == "__main__":
    unittest.main()
