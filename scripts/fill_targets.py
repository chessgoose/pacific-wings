#!/usr/bin/env python3
"""
Post-processor for missions_chronology.csv skeleton.
Fills in end_lat, end_lng, target_name, duration_hours, and waypoints
by analyzing descriptions with action-verb patterns.

Logic:
- ACTION verbs (bomb, attack, strike, hit, raid) + place = TARGET
- ORIGIN verbs (from, based at, stage through) + place = NOT target
- Round-trip indicators (return to, land back) → waypoints = target, end = origin
- One-way (default) → end = target
- Ambiguous cases → to_check = true
"""

import csv
import re
import math
import sys

CSV_IN = "data/missions_chronology.csv"
CSV_OUT = "data/missions_chronology.csv"
TARGETS_CSV = "data/targets.csv"
BASES_CSV = "data/bases.csv"

# ── Load targets ──────────────────────────────────────────────────────

def load_targets(path):
    """Load targets.csv into a dict of {name_lower: (lat, lng, canonical_name)}
    Also index aliases. Handles variable alias columns."""
    targets = {}
    with open(path, newline='', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('name,'):
                continue
            parts = line.split(',')
            # Format: name, alias1, alias2, ..., lat, lng, country, type
            # Find lat/lng: first pair of consecutive float-parseable values
            name = parts[0].strip()
            if not name:
                continue
            lat = lng = None
            lat_idx = None
            for i in range(1, len(parts) - 1):
                try:
                    lat_candidate = float(parts[i].strip().replace('−', '-'))
                    lng_candidate = float(parts[i+1].strip().replace('−', '-'))
                    # Validate ranges
                    if -90 <= lat_candidate <= 90 and -180 <= lng_candidate <= 180:
                        lat = lat_candidate
                        lng = lng_candidate
                        lat_idx = i
                        break
                except ValueError:
                    continue
            if lat is None:
                continue
            # All parts between name and lat are aliases
            aliases = [parts[j].strip() for j in range(1, lat_idx) if parts[j].strip()]
            # Primary name
            targets[name.lower()] = (lat, lng, name)
            for alias in aliases:
                targets[alias.lower()] = (lat, lng, name)
    return targets


def load_bases(path):
    """Load base names to exclude from target matching."""
    bases = set()
    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            base = row['base_name'].strip()
            if base:
                # Extract the short name (first word or two)
                bases.add(base.lower())
    return bases


# ── Haversine ─────────────────────────────────────────────────────────

def haversine_nm(lat1, lng1, lat2, lng2):
    """Great-circle distance in nautical miles."""
    R = 3440.065  # Earth radius in nm
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def estimate_duration(lat1, lng1, lat2, lng2, speed_kts, round_trip=False):
    """Estimate flight duration in hours."""
    dist = haversine_nm(lat1, lng1, lat2, lng2)
    if round_trip:
        dist *= 2
    if speed_kts <= 0:
        speed_kts = 200
    return round(dist / speed_kts, 1)


# ── Target extraction from descriptions ──────────────────────────────

# Action verbs that indicate the following place is a TARGET
ACTION_PATTERNS = [
    r'\b(?:bomb|bombs|bombing|bombed)\b[^.;]*?\b',
    r'\b(?:attack|attacks|attacking|attacked)\b[^.;]*?\b',
    r'\b(?:strike|strikes|striking|struck)\b[^.;]*?\b',
    r'\b(?:hit|hits|hitting)\b[^.;]*?\b',
    r'\b(?:raid|raids|raiding|raided)\b\s+(?:on\s+|against\s+)?[^.;]*?\b',
    r'\b(?:against)\b[^.;]*?\b',
    r'\bmission\s+(?:to|over|against)\b[^.;]*?\b',
    r'\b(?:over)\b[^.;]*?\b',
    r'\b(?:strafe|strafes|strafing|strafed)\b[^.;]*?\b',
    r'\btgt[s]?\s+(?:at|in|on|near)\b[^.;]*?\b',
    r'\btarget[s]?\s+(?:at|in|on|near)\b[^.;]*?\b',
    r'\b(?:intercept|interception)\b[^.;]*?\b',
]

# Origin patterns - place after these is NOT a target
ORIGIN_PATTERNS = [
    r'\bfrom\s+',
    r'\bbased\s+at\s+',
    r'\bstage[ds]?\s+through\s+',
    r'\bfly\s+out\s+of\s+',
    r'\bflying\s+out\s+of\s+',
    r'\btake[s]?\s+off\s+from\s+',
    r'\bdepart[s]?\s+(?:from\s+)?',
    r'\boperating\s+(?:from|out\s+of)\s+',
    r'\barrive[s]?\s+at\s+',
    r'\bland[s]?\s+(?:at|on)\s+',
]

# Round-trip indicators - must be AAF returning, not enemy
ROUND_TRIP_PATTERNS = [
    r'(?:b-17|b-24|b-25|b-29|p-38|p-40|p-47|p-51|a-20|a-26|ftr|bmr|hb)s?\b[^.]*\breturn',
    r'\bstage[sd]?\s+through\b[^.]*\breturn',
    r'\bland(?:s|ing|ed)?\s+back\b',
    r'\bround[\s-]?trip\b',
    r'\band\s+return\s+to\s+base\b',
]


def find_target_in_description(desc, targets_dict, origin_base):
    """
    Analyze description to find the primary bombing/attack target.
    Returns (target_name, lat, lng, is_round_trip, confidence)
    confidence: 'high' = definitive match, 'low' = ambiguous
    """
    desc_lower = desc.lower()

    # Check for round trip
    is_round_trip = any(re.search(p, desc_lower) for p in ROUND_TRIP_PATTERNS)

    # Collect origin places (to exclude from targets)
    origin_places = set()
    for pat in ORIGIN_PATTERNS:
        for m in re.finditer(pat, desc_lower):
            # Get text after the origin pattern
            after = desc_lower[m.end():m.end()+80]
            for tname, (tlat, tlng, tcanon) in targets_dict.items():
                if after.startswith(tname) or re.match(r'\s*' + re.escape(tname), after):
                    origin_places.add(tname)

    # Also add the origin base itself and common base-name words
    if origin_base:
        origin_places.add(origin_base.lower())
        # Add meaningful sub-parts (e.g., "Clark" from "Clark Field Philippines")
        for word in origin_base.lower().replace(',', ' ').split():
            if len(word) > 3 and word not in ('field', 'island', 'islands', 'base', 'philippines', 'australia', 'china', 'india', 'burma', 'hawaii', 'new', 'guinea', 'aleutians'):
                origin_places.add(word)

    # Now find targets using action patterns
    # Strategy: find all place names that appear after action verbs
    found_targets = []

    # Common English words that happen to be target aliases - causes false positives
    ENGLISH_BLACKLIST = {'but', 'del', 'los'}

    # Sort targets by name length (longest first) to match longer names before substrings
    sorted_targets = sorted(
        ((k, v) for k, v in targets_dict.items() if k not in ENGLISH_BLACKLIST),
        key=lambda x: -len(x[0])
    )

    for tname, (tlat, tlng, tcanon) in sorted_targets:
        if len(tname) < 3:
            continue
        # Skip if this place is identified as an origin
        if tname in origin_places:
            continue

        # Check if this target name appears in the description
        # Use word boundary matching
        pattern = r'\b' + re.escape(tname) + r'\b'
        matches = list(re.finditer(pattern, desc_lower))
        if not matches:
            continue

        # For each match, check if it follows an action verb
        for match in matches:
            pos = match.start()
            # Look at the 120 chars before this match for action context
            before = desc_lower[max(0, pos-120):pos]

            # Check if preceded by an action verb
            is_action_target = False
            for action_pat in [
                r'bomb(?:s|ing|ed)?',
                r'attack(?:s|ing|ed)?',
                r'strike(?:s|ing|struck)?',
                r'hit(?:s|ting)?',
                r'raids?\s+(?:on|against)',
                r'raid(?:s|ing|ed)?',
                r'against',
                r'mission\s+(?:to|over|against)',
                r'strafe[ds]?|strafing',
                r'tgts?\s+(?:at|in|on|near)',
                r'targets?\s+(?:at|in|on|near)',
                r'intercept(?:s|ion|ing|ed)?',
                r'rcn\s+(?:over|of|to)',
                r'sweep[s]?\s+(?:over|of|to|against)',
                r'patrol[s]?\s+(?:over|of|to)',
                r'mine[s]?\s+(?:at|in|off|near)',
                r'mining\s+(?:at|in|off|near)',
                r'shipping\s+(?:at|in|off|near)',
                r'over\b',
            ]:
                if re.search(action_pat + r'[^.;]{0,60}$', before):
                    is_action_target = True
                    break

            # Also check for patterns like "at/in/on/near TARGET" after action verbs
            before_short = desc_lower[max(0, pos-30):pos]
            if re.search(r'\b(?:at|in|on|near|of|off|over)\s+$', before_short):
                # Check further back for action verb
                before_long = desc_lower[max(0, pos-150):pos]
                if re.search(r'(?:bomb|attack|strike|hit|raid|strafe|rcn|sweep|patrol|mine|shipping|tgt|target)', before_long):
                    is_action_target = True

            if is_action_target:
                found_targets.append((tcanon, tlat, tlng, pos))
                break  # One match per target name is enough

    if not found_targets:
        # Fallback: just find any target name in the description that isn't an origin
        # but mark as low confidence
        for tname, (tlat, tlng, tcanon) in sorted_targets:
            if len(tname) < 4:
                continue
            if tname in origin_places:
                continue
            pattern = r'\b' + re.escape(tname) + r'\b'
            if re.search(pattern, desc_lower):
                return (tcanon, tlat, tlng, is_round_trip, 'low')
        return None

    # Return the first (earliest in text) target found with high confidence
    found_targets.sort(key=lambda x: x[3])  # sort by position in text
    best = found_targets[0]
    return (best[0], best[1], best[2], is_round_trip, 'high')


# ── Speed lookup ──────────────────────────────────────────────────────

AIRCRAFT_SPEEDS = {
    'b-17': 182, 'b-24': 215, 'b-25': 230, 'b-26': 216, 'b-29': 220,
    'b-32': 230, 'a-20': 300, 'a-24': 180, 'a-25': 180, 'a-26': 287,
    'a-36': 250, 'p-38': 290, 'p-39': 280, 'p-40': 310, 'p-47': 300,
    'p-51': 340, 'p-61': 300, 'p-70': 280,
    'f4u': 300, 'f6f': 310,
    'heavy bomber': 200, 'medium bomber': 230, 'light bomber': 280,
    'fighter': 320, 'fighter-bomber': 300,
    'unknown': 250,
}

def get_speed(aircraft_type):
    t = aircraft_type.lower()
    for key, spd in AIRCRAFT_SPEEDS.items():
        if key in t:
            return spd
    return 250


# ── Main ──────────────────────────────────────────────────────────────

def main():
    targets_dict = load_targets(TARGETS_CSV)
    bases = load_bases(BASES_CSV)

    print(f"Loaded {len(targets_dict)} target entries")
    print(f"Loaded {len(bases)} base entries")

    # Read skeleton CSV
    rows = []
    with open(CSV_IN, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            rows.append(row)

    print(f"Read {len(rows)} rows from {CSV_IN}")

    stats = {'filled_high': 0, 'filled_low': 0, 'no_target': 0, 'round_trip': 0, 'one_way': 0}

    for row in rows:
        desc = row.get('description', '')
        origin_base = row.get('origin_base', '')
        aircraft_type = row.get('type', '')
        start_lat = row.get('start_lat', '')
        start_lng = row.get('start_lng', '')

        if not desc or not start_lat or not start_lng:
            stats['no_target'] += 1
            continue

        result = find_target_in_description(desc, targets_dict, origin_base)

        if result is None:
            stats['no_target'] += 1
            continue

        target_name, target_lat, target_lng, is_round_trip, confidence = result

        s_lat = float(start_lat)
        s_lng_f = float(start_lng)

        # Skip if target is basically the same as origin (within 20nm)
        if haversine_nm(s_lat, s_lng_f, target_lat, target_lng) < 20:
            stats['no_target'] += 1
            continue
        s_lng = float(start_lng)
        speed = get_speed(aircraft_type)

        if is_round_trip:
            # End point = back at origin, waypoints go through target
            row['end_lat'] = start_lat
            row['end_lng'] = start_lng
            row['waypoints'] = f"{s_lat}:{s_lng};{target_lat}:{target_lng};{s_lat}:{s_lng}"
            duration = estimate_duration(s_lat, s_lng, target_lat, target_lng, speed, round_trip=True)
            stats['round_trip'] += 1
        else:
            # One-way: end at target
            row['end_lat'] = str(target_lat)
            row['end_lng'] = str(target_lng)
            row['waypoints'] = ''
            duration = estimate_duration(s_lat, s_lng, target_lat, target_lng, speed, round_trip=False)
            stats['one_way'] += 1

        row['target_name'] = target_name
        row['duration_hours'] = str(duration)

        if confidence == 'low':
            row['to_check'] = 'true'
            stats['filled_low'] += 1
        else:
            stats['filled_high'] += 1

    # Write output
    with open(CSV_OUT, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nResults:")
    print(f"  High-confidence fills: {stats['filled_high']}")
    print(f"  Low-confidence (to_check): {stats['filled_low']}")
    print(f"  No target found: {stats['no_target']}")
    print(f"  Round trips: {stats['round_trip']}")
    print(f"  One-way trips: {stats['one_way']}")
    print(f"\nWrote {len(rows)} rows → {CSV_OUT}")


if __name__ == '__main__':
    main()
