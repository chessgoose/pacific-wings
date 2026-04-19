#!/usr/bin/env python3
"""
Generate bases_data.js from bases.csv
Usage: python3 scripts/generate-bases-data.py
"""

import os
import sys
import csv

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(script_dir, '../data/bases.csv')
    output_file = os.path.join(script_dir, '../data/bases_data.js')

    if not os.path.exists(csv_file):
        print(f"Error: CSV file not found: {csv_file}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading CSV from: {csv_file}")
    rows = []
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    entries = []
    for row in rows:
        af = row['af'].replace('"', '\\"')
        start = row['start_date'].strip()
        end = row['end_date'].strip()
        name = row['base_name'].replace('"', '\\"')
        lat = float(row['lat'])
        lng = float(row['lng'])
        notes = row['notes'].replace('"', '\\"')
        entries.append(
            f'  {{af:"{af}",start:"{start}",end:"{end}",name:"{name}",lat:{lat},lng:{lng},notes:"{notes}"}}'
        )

    js_content = "// Auto-generated from bases.csv\nwindow.BASES_DATA = [\n"
    js_content += ",\n".join(entries)
    js_content += "\n];\n"

    print(f"Writing to: {output_file}")
    with open(output_file, 'w') as f:
        f.write(js_content)

    print(f"✓ bases_data.js updated successfully")
    print(f"  {len(rows)} base entries")

if __name__ == '__main__':
    main()
