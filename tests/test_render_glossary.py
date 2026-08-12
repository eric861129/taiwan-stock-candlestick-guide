from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


PROJECT_ROOT = Path(__file__).parents[1]
TOOLS_DIRECTORY = PROJECT_ROOT / "tools"
CONTEXT_PATH = PROJECT_ROOT / "CONTEXT.md"
sys.path.insert(0, str(TOOLS_DIRECTORY))

from render_glossary import GlossaryEntry, GlossaryError, parse_context, render_glossary


EXPECTED_TERMS_AND_AVOIDS = (
    ("K 線", "蠟燭圖、單根預言"),
    ("時間週期", "未標明週期的走勢"),
    ("已完成週期 K 棒", "把盤中、本週或本月尚未結束的資料當成定案"),
    ("形成中週期 K 棒", "未完成 K 棒、把形成中結果納入型態計分"),
    ("趨勢", "一定漲、一定跌"),
    ("關鍵區域", "精確到單一價位的神奇線"),
    ("支撐區", "保證不跌破的支撐線"),
    ("壓力區", "保證無法突破的壓力線"),
    ("量價關係", "只憑爆量或量縮直接判定漲跌"),
    ("技術指標", "指標投票、萬用指標"),
    ("ATR", "把高 ATR 解釋成看多或看空"),
    ("市場狀態", "不分環境套用同一型態"),
    ("原始價格", "未說明資料類型的歷史股價"),
    ("還原價格", "把調整後價格當成當日實際成交價"),
    ("向後還原價格", "自行消除異常跳空、沒有調整依據的連續價格"),
    ("價格模式", "用還原價格畫圖卻顯示原始價格結果、混合價格模式"),
    ("週期聚合", "固定每五日當一週、固定每二十日當一月"),
    ("交易情境", "行情預言、明牌"),
    ("觸發條件", "感覺可以買、感覺可以賣"),
    ("失效條件", "再等等看、凹單理由"),
    ("停損", "隨情緒移動的停損、保證不賠"),
    ("部位大小", "憑信心重押、固定買滿"),
    ("滑價", "假設每次都能成交在圖表標示價"),
    ("R 倍數", "只比較金額、忽略每筆交易承擔的風險"),
    ("勝率", "單獨用高勝率證明策略有效"),
    ("賺賠比", "只看單筆最大獲利"),
    ("期望值", "保證獲利、用少量案例推論長期結果"),
    ("多時間週期判讀", "同時查看大量週期直到找到想要的答案"),
    ("多時間週期摘要", "週期投票、用月 K 結論覆蓋其他週期"),
    ("跨週期背景提示", "用較長週期替短週期加分、隱藏不同週期的有效候選"),
    ("學習路徑", "只列章節的目錄、沒有先後關係的自由瀏覽"),
    ("型態卡（Pattern Card）", "必漲圖、必跌圖、明牌卡"),
    ("TA-Lib 進階 K 棒圖鑑", "只翻譯函式名稱的清單、宣稱所有 TA-Lib 型態都能自動預測"),
    ("型態集合（Pattern Collection）", "為每個頁面複製一份型態定義、用分類名稱取代穩定型態識別碼"),
    ("K 棒型態（Candlestick Pattern）", "把單根 K 棒稱為完整價格結構、單憑形狀預測方向"),
    ("價格結構型態（Chart Pattern）", "進階 K 線型態、只看最後一根 K 棒的完整圖形"),
    ("型態相似度分析", "股價預測、走勢預言、買賣訊號"),
    ("型態候選", "唯一答案、買進訊號、賣出訊號"),
    ("接近但未成立的教學參考", "湊滿前三名、低信心候選"),
    ("型態確認狀態", "看到輪廓就算成立、事後補畫確認點"),
    ("規則符合度", "上漲機率、勝率、AI 信心"),
    ("條件式情境投影", "預測線、未來走勢圖、保證路徑"),
    ("無明顯型態", "分析失敗、硬選最像的一張"),
    ("分析區間", "只看最後一根 K 線、未標明範圍的近期走勢"),
    ("公司行動干擾", "技術性跳空、突破缺口"),
    ("型態規則", "憑感覺辨識、黑箱答案"),
    ("型態規則族", "為每張卡複製一份近似規則、讓教學說明與比對程式各自定義"),
    ("可比對型態卡", "宣稱所有教學概念都能只靠日 K 資料可靠辨識"),
    ("證據不足", "把資料不足當成無明顯型態、為了產生答案而降低必要條件"),
    ("市場資料快照", "即時行情、未經驗證的 API 回應"),
    ("資料截止日", "今天資料、最新資料，但沒有標示實際日期"),
    ("資料新鮮度", "只用檔案產生時間判斷行情是否最新"),
    ("歷史案例", "用已知結果倒推完美理由"),
    ("證據等級", "把經驗法則包裝成市場定律"),
    ("觀察", "在事實描述中混入看多、看空或原因推測"),
    ("解釋", "把可能性寫成確定結果"),
    ("遮圖測驗", "看完答案再解釋、事後諸葛"),
    ("紙上交易", "事後挑選完美進出點"),
    ("放棄交易條件", "為了每天都要交易而降低標準"),
    ("交易紀錄", "只記損益、不記決策"),
    ("判讀流程", "只找熟悉型態後直接下結論"),
)


class ParseContextTests(unittest.TestCase):
    def test_current_context_has_all_canonical_entries_in_order_and_each_renders_once(self):
        entries = parse_context(CONTEXT_PATH)

        self.assertEqual(len(EXPECTED_TERMS_AND_AVOIDS), len(entries))
        self.assertEqual(
            EXPECTED_TERMS_AND_AVOIDS,
            tuple((entry.term, entry.avoid) for entry in entries),
        )

        rendered = render_glossary(entries)
        heading_positions = []
        for term, avoid in EXPECTED_TERMS_AND_AVOIDS:
            heading = f"## {term}\n"
            self.assertEqual(1, rendered.count(heading))
            self.assertEqual(1, rendered.count(f"**避免使用**：{avoid}"))
            heading_positions.append(rendered.index(heading))
        self.assertEqual(sorted(heading_positions), heading_positions)

    def test_parser_preserves_multiline_definition_and_ignores_preamble(self):
        with TemporaryDirectory() as temporary_directory:
            source = Path(temporary_directory) / "CONTEXT.md"
            source.write_text(
                "# 教材前言\n\n"
                "**一般前言**：這不是可解析的詞彙條目。\n\n"
                "## 分類標題\n\n"
                "**多行詞彙**：\n"
                "第一行定義。\n\n"
                "第二行定義保留段落。\n"
                "_避免使用_：過度簡化\n",
                encoding="utf-8",
                newline="\n",
            )

            entries = parse_context(source)

        self.assertEqual(("多行詞彙",), tuple(entry.term for entry in entries))
        self.assertEqual("第一行定義。\n\n第二行定義保留段落。", entries[0].definition)
        self.assertEqual("過度簡化", entries[0].avoid)

    def test_parser_rejects_incomplete_or_invalid_context_with_named_errors(self):
        cases = (
            ("orphan", "_避免使用_：沒有詞彙\n", "孤立的避免使用"),
            ("missing-definition", "**缺定義**：\n_避免使用_：不要省略\n", "缺少定義"),
            ("missing-avoid", "**缺避免**：\n完整定義。\n", "缺少避免使用"),
            (
                "duplicate-term",
                "**重複**：\n第一個定義。\n_避免使用_：第一個\n\n"
                "**重複**：\n第二個定義。\n_避免使用_：第二個\n",
                "重複 term",
            ),
            ("no-entry", "# 只有前言\n\n沒有可解析詞彙。\n", "沒有詞彙條目"),
        )

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for name, content, message in cases:
                with self.subTest(name=name):
                    source = root / f"{name}.md"
                    source.write_text(content, encoding="utf-8", newline="\n")
                    with self.assertRaisesRegex(GlossaryError, message):
                        parse_context(source)

            invalid_utf8 = root / "invalid-utf8.md"
            invalid_utf8.write_bytes(b"\xff")
            with self.assertRaisesRegex(GlossaryError, "UTF-8"):
                parse_context(invalid_utf8)


class RenderGlossaryTests(unittest.TestCase):
    def test_renderer_is_deterministic_and_declares_context_as_the_only_source(self):
        entries = (
            GlossaryEntry("甲詞", "第一行定義。\n第二行定義。", "不要甲"),
            GlossaryEntry("乙詞", "乙詞定義。", "不要乙"),
        )

        first = render_glossary(entries)
        second = render_glossary(entries)

        self.assertEqual(first, second)
        self.assertTrue(first.endswith("\n"))
        self.assertIn("# 附錄 D：詞彙表", first)
        self.assertIn("自動產生", first)
        self.assertIn("CONTEXT.md", first)
        self.assertIn("唯一來源", first)
        self.assertIn("請勿手動修改", first)
        self.assertIn("## 甲詞\n\n第一行定義。\n第二行定義。\n\n**避免使用**：不要甲", first)


class GlossaryCliTests(unittest.TestCase):
    def _write_context(self, path: Path) -> None:
        path.write_text(
            "# 測試詞彙\n\n"
            "**測試詞**：\n"
            "測試定義。\n"
            "_避免使用_：測試禁語\n",
            encoding="utf-8",
            newline="\n",
        )

    def _run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(TOOLS_DIRECTORY / "render_glossary.py"), *arguments],
            cwd=PROJECT_ROOT,
            capture_output=True,
            encoding="utf-8",
            text=True,
            check=False,
        )

    def test_cli_generates_lf_utf8_output_and_check_is_byte_identical(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "CONTEXT.md"
            output = root / "chapters" / "appendix-d-glossary.md"
            self._write_context(source)

            generated = self._run_cli("--source", str(source), "--output", str(output))
            generated_bytes = output.read_bytes()
            checked = self._run_cli("--source", str(source), "--output", str(output), "--check")
            checked_bytes = output.read_bytes()

        self.assertEqual(0, generated.returncode, generated.stderr)
        self.assertEqual("", generated.stderr)
        self.assertNotIn(b"\r\n", generated_bytes)
        self.assertEqual(0, checked.returncode, checked.stderr)
        self.assertEqual(generated_bytes, checked_bytes)

    def test_check_rejects_missing_or_stale_output_without_modifying_it(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "CONTEXT.md"
            output = root / "appendix-d-glossary.md"
            self._write_context(source)

            missing = self._run_cli("--source", str(source), "--output", str(output), "--check")
            missing_output_exists = output.exists()
            output.write_bytes("過期內容\n".encode("utf-8"))
            stale_before = output.read_bytes()
            stale = self._run_cli("--source", str(source), "--output", str(output), "--check")
            stale_after = output.read_bytes()

        self.assertNotEqual(0, missing.returncode)
        self.assertIn("不存在", missing.stderr)
        self.assertFalse(missing_output_exists)
        self.assertNotEqual(0, stale.returncode)
        self.assertIn("過期", stale.stderr)
        self.assertEqual(stale_before, stale_after)

    def test_cli_reports_argument_and_io_errors_without_traceback(self):
        with TemporaryDirectory() as temporary_directory:
            directory_source = Path(temporary_directory) / "source-directory"
            directory_source.mkdir()
            output = Path(temporary_directory) / "output.md"
            argument_error = self._run_cli()
            io_error = self._run_cli("--source", str(directory_source), "--output", str(output))

        self.assertNotEqual(0, argument_error.returncode)
        self.assertNotIn("Traceback", argument_error.stderr)
        self.assertNotEqual(0, io_error.returncode)
        self.assertIn("error:", io_error.stderr)
        self.assertNotIn("Traceback", io_error.stderr)


if __name__ == "__main__":
    unittest.main()
