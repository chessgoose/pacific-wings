#!/usr/bin/env python3
"""
Generate missions_data.js from missions_chronology.csv
Usage: python3 scripts/generate-missions-data.py
"""

import os
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(script_dir, '../data/missions_chronology.csv')
    output_file = os.path.join(script_dir, '../data/missions_data.js')

    if not os.path.exists(csv_file):
        print(f"Error: CSV file not found: {csv_file}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading CSV from: {csv_file}")
    with open(csv_file, 'r') as f:
        csv_content = f.read()

    js_content = f"""// Auto-generated from missions_chronology.csv
window.MISSIONS_CSV = `
{csv_content}`;
"""

    print(f"Writing to: {output_file}")
    with open(output_file, 'w') as f:
        f.write(js_content)

    line_count = csv_content.count('\n') + 1
    print(f"✓ missions_data.js updated successfully")
    print(f"  {line_count} lines")

if __name__ == '__main__':
    main()
