#!/usr/bin/env python3
"""
Generate targets_data.js from targets.csv
Usage: python3 scripts/generate-targets-data.py
"""

import os
import sys
import csv
import json

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(script_dir, '../data/targets.csv')
    output_file = os.path.join(script_dir, '../data/targets_data.js')

    if not os.path.exists(csv_file):
        print(f"Error: CSV file not found: {csv_file}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading CSV from: {csv_file}")
    rows = []
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    entries = []
    for row in rows:
        name = row['name']
        aliases_raw = row['aliases'].strip()
        aliases = [a.strip() for a in aliases_raw.split(',') if a.strip()] if aliases_raw else []
        lat = float(row['lat']) if row['lat'].strip() else None
        lng = float(row['lng']) if row['lng'].strip() else None
        country = row['country']
        target_type = row['type']

        aliases_js = json.dumps(aliases, ensure_ascii=False)
        name_js = json.dumps(name, ensure_ascii=False)
        country_js = json.dumps(country, ensure_ascii=False)
        type_js = json.dumps(target_type, ensure_ascii=False)
        lat_js = 'null' if lat is None else str(lat)
        lng_js = 'null' if lng is None else str(lng)

        entries.append(
            f'  {{name:{name_js},aliases:{aliases_js},lat:{lat_js},lng:{lng_js},country:{country_js},type:{type_js}}}'
        )

    js_content = "// Auto-generated from targets.csv\nwindow.TARGETS_DATA = [\n"
    js_content += ",\n".join(entries)
    js_content += "\n];\n"

    print(f"Writing to: {output_file}")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"✓ targets_data.js updated successfully")
    print(f"  {len(rows)} target entries")

if __name__ == '__main__':
    main()
