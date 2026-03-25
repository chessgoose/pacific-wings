# Pacific Wings - WWII Flight Tracker

A historical flight visualization and tracking tool focused on the Pacific Theater (1944-1945).

## Features

- **Historical Accuracy**: Precise coordinates and timing for major operations including Hiroshima and Nagasaki.
- **Dynamic Timeline**: Fine-tune time by the hour or drag a high-resolution slider for minute-by-minute tracking.
- **Mission Import**: Import your own mission data via CSV/spreadsheet format.
- **Jump Points**: Instantly skip to major historical events across the Pacific front.
- **Blue-Themed Dark Mode**: A premium, nocturnal aesthetic designed for clarity and modern tracking visuals.

## How to Run

1. Clone this repository.
2. Open `index.html` in any modern web browser.
3. Use the sidebar to explore missions or import your own!

## Deployment

The application is built using Leaflet.js, Vanilla Javascript, and CSS. It can be hosted on any static site provider like GitHub Pages.

## OCR Utility

This repo now includes a small OCR helper for `The B-29 Superfortress.pdf` in [`ocr/ocr_b29.py`](./ocr/ocr_b29.py).

1. Create a virtual environment: `python3 -m venv ocr/.venv`
2. Activate it: `source ocr/.venv/bin/activate`
3. Install dependencies: `pip install -r ocr/requirements.txt`
4. Run OCR: `python ocr/ocr_b29.py`

The script writes page-by-page text files plus one combined text file into `ocr/output/`.

## B-29 Table Extraction

Pages 26 through 101 of `The B-29 Superfortress.pdf` already contain embedded text, so those table pages can be extracted to CSV without OCR.

1. Activate the virtual environment: `source ocr/.venv/bin/activate`
2. Install dependencies if needed: `pip install -r ocr/requirements.txt`
3. Run the extractor: `python ocr/extract_b29_tables.py`

The extractor writes a CSV to `ocr/output/b29_master_list_pages_026_101.csv` with:
`source_page`, `serial_number`, `name`, `identification`, `delivery`, `assignment`, `off_inventory`, and `circumstances`.
