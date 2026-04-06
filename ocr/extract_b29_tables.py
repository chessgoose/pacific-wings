#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import pdfplumber


ROW_TOLERANCE = 3.0
COLUMN_BOUNDS = [
    ("serial_number", 0.0, 67.0),
    ("name", 67.0, 165.0),
    ("identification", 165.0, 238.0),
    ("delivery", 238.0, 278.0),
    ("assignment", 278.0, 311.0),
    ("off_inventory", 311.0, 350.0),
    ("circumstances", 350.0, float("inf")),
]
CSV_COLUMNS = [column for column, _, _ in COLUMN_BOUNDS]
SERIAL_RE = re.compile(r"^\d{2}-\d{4,5}$")


@dataclass
class Row:
    serial_number: str = ""
    name: str = ""
    identification: str = ""
    delivery: str = ""
    assignment: str = ""
    off_inventory: str = ""
    circumstances: str = ""
    source_page: int = 0

    def to_csv_row(self) -> dict[str, str | int]:
        return {
            "source_page": self.source_page,
            "serial_number": self.serial_number,
            "name": self.name,
            "identification": self.identification,
            "delivery": self.delivery,
            "assignment": self.assignment,
            "off_inventory": self.off_inventory,
            "circumstances": self.circumstances,
        }


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    default_pdf = repo_root / "The B-29 Superfortress.pdf"
    default_output = Path(__file__).resolve().parent / "output" / "b29_master_list_pages_026_101.csv"

    parser = argparse.ArgumentParser(
        description="Extract the B-29 master list tables from embedded PDF text and write them to CSV."
    )
    parser.add_argument(
        "--pdf",
        type=Path,
        default=default_pdf,
        help=f"Path to the source PDF (default: {default_pdf})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help=f"CSV output path (default: {default_output})",
    )
    parser.add_argument(
        "--start-page",
        type=int,
        default=26,
        help="First 1-based page to extract (default: 26).",
    )
    parser.add_argument(
        "--end-page",
        type=int,
        default=101,
        help="Last 1-based page to extract, inclusive (default: 101).",
    )
    return parser.parse_args()


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def find_header_bottom(words: list[dict[str, float | str]]) -> float:
    header_words = {"Serial#", "Name", "Identification", "Delv", "Arsign", "Assign", "Off", "Inv", "Circumstances"}
    bottoms = [
        float(word["bottom"])
        for word in words
        if str(word["text"]) in header_words
    ]
    return max(bottoms) if bottoms else 65.0


def assign_column(x0: float) -> str:
    for column, start, end in COLUMN_BOUNDS:
        if start <= x0 < end:
            return column
    return "circumstances"


def cluster_words_into_lines(words: list[dict[str, float | str]]) -> list[list[dict[str, float | str]]]:
    lines: list[list[dict[str, float | str]]] = []

    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        top = float(word["top"])
        if lines and abs(top - float(lines[-1][0]["top"])) <= ROW_TOLERANCE:
            lines[-1].append(word)
        else:
            lines.append([word])

    for line in lines:
        line.sort(key=lambda item: float(item["x0"]))

    return lines


def line_to_row(line: list[dict[str, float | str]], source_page: int) -> Row:
    bucketed: dict[str, list[str]] = {column: [] for column in CSV_COLUMNS}

    for word in line:
        column = assign_column(float(word["x0"]))
        bucketed[column].append(str(word["text"]))

    return Row(
        serial_number=normalize_text(" ".join(bucketed["serial_number"])),
        name=normalize_text(" ".join(bucketed["name"])),
        identification=normalize_text(" ".join(bucketed["identification"])),
        delivery=normalize_text(" ".join(bucketed["delivery"])),
        assignment=normalize_text(" ".join(bucketed["assignment"])),
        off_inventory=normalize_text(" ".join(bucketed["off_inventory"])),
        circumstances=normalize_text(" ".join(bucketed["circumstances"])),
        source_page=source_page,
    )


def is_footer_or_heading(row: Row) -> bool:
    compact_serial = row.serial_number.replace(" ", "")
    compact_name = row.name.replace(" ", "")
    return compact_serial in {"I.", "12", "13", "26", "87"} or compact_name == "MasterList"


def merge_continuation_rows(rows: list[Row]) -> list[Row]:
    merged: list[Row] = []

    for row in rows:
        if is_footer_or_heading(row):
            continue

        if row.serial_number and SERIAL_RE.match(row.serial_number):
            merged.append(row)
            continue

        if not merged:
            continue

        previous = merged[-1]
        for column in CSV_COLUMNS[1:]:
            value = getattr(row, column)
            if not value:
                continue
            current = getattr(previous, column)
            setattr(previous, column, normalize_text(f"{current} {value}" if current else value))

    return merged


def extract_page_rows(page: pdfplumber.page.Page, page_number: int) -> list[Row]:
    words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False)
    if not words:
        return []

    header_bottom = find_header_bottom(words)
    body_words = [word for word in words if float(word["top"]) > header_bottom + 4]
    lines = cluster_words_into_lines(body_words)
    raw_rows = [line_to_row(line, page_number) for line in lines]
    return merge_continuation_rows(raw_rows)


def validate_page_range(start_page: int, end_page: int, total_pages: int) -> None:
    if start_page < 1 or end_page < 1:
        raise ValueError("Page numbers must be 1-based positive integers.")
    if start_page > end_page:
        raise ValueError("start-page must be less than or equal to end-page.")
    if end_page > total_pages:
        raise ValueError(f"PDF only has {total_pages} pages, but end-page={end_page}.")


def write_csv(rows: list[Row], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["source_page", *CSV_COLUMNS])
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_csv_row())


def main() -> int:
    args = parse_args()

    pdf_path = args.pdf.expanduser().resolve()
    output_path = args.output.expanduser().resolve()

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    with pdfplumber.open(str(pdf_path)) as pdf:
        validate_page_range(args.start_page, args.end_page, len(pdf.pages))
        rows: list[Row] = []

        for page_number in range(args.start_page, args.end_page + 1):
            page_rows = extract_page_rows(pdf.pages[page_number - 1], page_number)
            rows.extend(page_rows)
            print(f"Extracted {len(page_rows)} rows from page {page_number}")

    write_csv(rows, output_path)
    print(f"\nWrote {len(rows)} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
