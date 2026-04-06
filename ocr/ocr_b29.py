#!/usr/bin/env python3

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pytesseract
from PIL import Image


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    default_pdf = repo_root / "The B-29 Superfortress.pdf"
    default_output = Path(__file__).resolve().parent / "output"

    parser = argparse.ArgumentParser(
        description="Run OCR on a PDF using Tesseract and write page-level plus combined text output."
    )
    parser.add_argument(
        "--pdf",
        type=Path,
        default=default_pdf,
        help=f"Path to the source PDF (default: {default_pdf})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_output,
        help=f"Directory for OCR text output (default: {default_output})",
    )
    parser.add_argument(
        "--lang",
        default="eng",
        help="Tesseract language code(s), e.g. 'eng' or 'eng+deu'.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="Render resolution for OCR. Higher values improve accuracy but take longer.",
    )
    parser.add_argument(
        "--limit-pages",
        type=int,
        default=None,
        help="Optional page limit for quick tests.",
    )
    return parser.parse_args()


def ensure_tesseract() -> None:
    if shutil.which("tesseract"):
        return

    print("Tesseract is not installed or not on PATH.", file=sys.stderr)
    print("Install it first, then rerun this script.", file=sys.stderr)
    sys.exit(1)


def render_page(page: pdfium.PdfPage, dpi: int) -> Image.Image:
    scale = dpi / 72
    bitmap = page.render(scale=scale)
    return bitmap.to_pil()


def main() -> int:
    args = parse_args()
    ensure_tesseract()

    pdf_path = args.pdf.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    combined_output = output_dir / f"{pdf_path.stem}.txt"

    document = pdfium.PdfDocument(str(pdf_path))
    total_pages = len(document)
    pages_to_process = total_pages if args.limit_pages is None else min(args.limit_pages, total_pages)

    combined_chunks: list[str] = []

    for page_index in range(pages_to_process):
        page = document[page_index]
        image = render_page(page, args.dpi)
        text = pytesseract.image_to_string(image, lang=args.lang).strip()

        page_output = output_dir / f"page-{page_index + 1:03d}.txt"
        page_output.write_text(text + "\n", encoding="utf-8")

        header = f"===== PAGE {page_index + 1} ====="
        combined_chunks.append(f"{header}\n{text}\n")
        print(f"OCR complete for page {page_index + 1}/{pages_to_process}: {page_output}")

    combined_output.write_text("\n".join(combined_chunks), encoding="utf-8")
    print(f"\nCombined OCR written to: {combined_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
