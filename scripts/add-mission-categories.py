#!/usr/bin/env python3
"""
Add mission_category column to missions_chronology.csv based on aircraft type and description keywords.
Safe to run repeatedly — it will overwrite an existing mission_category column or add a new one.

Categories:
  Enemy Action      - Japanese aircraft (A6M Zero)
  Reconnaissance    - Recon missions (F-5A Lightning, or "rcn"/"recon" in description)
  Patrol            - Patrol/seasearch/anti-sub missions
  Strategic Bombing - Heavy bombers (B-17, B-29, B-32, Heavy Bomber)
  Tactical Bombing  - Medium/light bombers (B-24, B-25, B-26, Medium Bomber, Light Bomber)
  Ground Attack     - Attack aircraft (A-20, A-26, A-36)
  Fighter           - Fighter aircraft (P-38, P-39, P-40, P-47, P-51, P-36, F4U, F6F)
  Other             - Anything else
"""

import csv
import io
import os
import sys

STRATEGIC_BOMBERS = {'B-17 Flying Fortress', 'B-29 Superfortress', 'B-32 Dominator', 'Heavy Bomber'}
TACTICAL_BOMBERS  = {'B-24 Liberator', 'B-25 Mitchell', 'B-26 Marauder', 'Medium Bomber', 'Light Bomber', 'B-18'}
ATTACK_AIRCRAFT   = {'A-20 Havoc', 'A-26 Invader', 'A-36 Apache'}
FIGHTERS          = {'P-40 Warhawk', 'P-38 Lightning', 'P-39 Airacobra', 'P-47 Thunderbolt',
                     'P-51 Mustang', 'P-36', 'Fighter', 'F4U Corsair', 'F6F Hellcat'}
RECON_AIRCRAFT    = {'F-5A Lightning'}
ENEMY_AIRCRAFT    = {'A6M Zero'}

RECON_KEYWORDS    = ['rcn', 'recon', 'reconnaissance', 'photographic mission', 'photo mission']
PATROL_KEYWORDS   = ['patrol', 'seasearch', 'sea search', 'anti-sub', 'antisubmarine',
                     'anti submarine', 'search mission', 'fly search', 'searches for']

def categorize(aircraft_type, description):
    t = aircraft_type.strip()
    d = description.lower()

    # 1. Enemy aircraft
    if t in ENEMY_AIRCRAFT:
        return 'Enemy Action'

    # 2. Recon — aircraft type takes priority, then description keywords
    if t in RECON_AIRCRAFT:
        return 'Reconnaissance'
    if any(kw in d for kw in RECON_KEYWORDS):
        return 'Reconnaissance'

    # 3. Patrol / anti-sub
    if any(kw in d for kw in PATROL_KEYWORDS):
        return 'Patrol'

    # 4. Aircraft-based categories
    if t in FIGHTERS:
        return 'Fighter'
    if t in STRATEGIC_BOMBERS:
        return 'Strategic Bombing'
    if t in TACTICAL_BOMBERS:
        return 'Tactical Bombing'
    if t in ATTACK_AIRCRAFT:
        return 'Ground Attack'

    return 'Other'


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_dir, '../data/missions_chronology.csv')

    if not os.path.exists(csv_path):
        print(f"Error: CSV not found at {csv_path}", file=sys.stderr)
        sys.exit(1)

    with open(csv_path, 'r', newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        rows = list(reader)

    if not rows:
        print("Error: CSV is empty", file=sys.stderr)
        sys.exit(1)

    header = rows[0]

    # Determine column indices (handle both fresh adds and re-runs)
    if 'mission_category' in header:
        cat_idx = header.index('mission_category')
        print(f"Updating existing mission_category column (index {cat_idx})...")
    else:
        cat_idx = len(header)
        header.append('mission_category')
        print(f"Adding new mission_category column at index {cat_idx}...")

    type_idx = header.index('type') if 'type' in header else 2
    desc_idx = header.index('description') if 'description' in header else 3

    updated = 0
    for row in rows[1:]:
        if len(row) < max(type_idx, desc_idx) + 1:
            # Pad short rows
            while len(row) <= cat_idx:
                row.append('')
            row[cat_idx] = ''
            continue

        aircraft_type = row[type_idx]
        description   = row[desc_idx]
        category      = categorize(aircraft_type, description)

        # Extend row if needed
        while len(row) <= cat_idx:
            row.append('')
        row[cat_idx] = category
        updated += 1

    # Write back
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL)
    writer.writerows([header] + rows[1:])

    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        f.write(out.getvalue())

    print(f"Done. Categorized {updated} rows.")

    # Count by category
    cats = {}
    for row in rows[1:]:
        if len(row) > cat_idx:
            c = row[cat_idx]
            cats[c] = cats.get(c, 0) + 1
    print("\nCategory breakdown:")
    for cat, count in sorted(cats.items(), key=lambda x: -x[1]):
        print(f"  {cat:<22} {count:>5}")


if __name__ == '__main__':
    main()
