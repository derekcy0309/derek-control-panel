"""Verify generated synthetic print PDFs, including every page's safe area.

Run with the bundled Python (pdfplumber): python tests/browser/check-print-margins.py file.pdf ...
"""
import sys
import pdfplumber

MIN_MARGIN_PT = 20  # About 7 mm; CSS supplies 8 mm even when page margins are disabled.

for filename in sys.argv[1:]:
    with pdfplumber.open(filename) as document:
        assert len(document.pages) >= 2, f"{filename}: expected multi-page test fixture"
        for number, page in enumerate(document.pages, 1):
            assert page.chars, f"{filename}: page {number} is empty"
            margin = min(
                min(char["x0"] for char in page.chars),
                page.width - max(char["x1"] for char in page.chars),
                min(char["top"] for char in page.chars),
                page.height - max(char["bottom"] for char in page.chars),
            )
            assert margin >= MIN_MARGIN_PT, f"{filename}: page {number} margin {margin:.1f}pt"
        print(f"PASS {filename}: {len(document.pages)} pages with safe print margins")
