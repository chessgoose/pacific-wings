#!/usr/bin/env python3
"""
parse_chronology.py

Reads ocr/output-combat-chronology/combat-chronology.txt, filters for
East Asia / Pacific Theater entries, and writes candidate rows to
data/missions_chronology.csv in the same format as data/missions.csv.

Usage:
    python3 scripts/parse_chronology.py
"""

import csv
import math
import re
import os
import sys
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
ROOT        = os.path.dirname(SCRIPT_DIR)
CHRONO_FILE = os.path.join(ROOT, "ocr", "output-combat-chronology", "combat-chronology.txt")
BASES_FILE  = os.path.join(ROOT, "data", "bases.csv")
TARGETS_FILE= os.path.join(ROOT, "data", "targets.csv")
OUT_FILE    = os.path.join(ROOT, "data", "missions_chronology.csv")

# ---------------------------------------------------------------------------
# East Asia Air Forces
# ---------------------------------------------------------------------------
EAST_ASIA_AFS = {
    "Hawaiian AF",      # pre-Feb 1942
    "FEAF",             # Far East Air Forces
    "Fifth AF",
    "Seventh AF",
    "Tenth AF",         # CBI (India/Burma/China)
    "Eleventh AF",      # Aleutians
    "Thirteenth AF",    # South/SW Pacific
    "Fourteenth AF",    # China
    "Twentieth AF",     # B-29s
}

# Keywords that flag an otherwise-excluded AF entry as East Asia relevant
EAST_ASIA_KEYWORDS = [
    # Japan
    "japan", "tokyo", "osaka", "nagoya", "kobe", "kyoto", "yokohama",
    "yokosuka", "hiroshima", "nagasaki", "yawata", "kokura", "sasebo",
    "omura", "kagoshima", "kure", "toyohashi", "hamamatsu", "tachikawa",
    "musashino", "kyushu", "honshu",
    # Korea / Manchuria
    "korea", "keijo", "seoul", "pyongyang", "rashin", "anshan", "mukden",
    "shenyang", "harbin", "dairen", "manchuria", "manchukuo",
    # China
    "china", "formosa", "taiwan", "shanghai", "nanking", "nanjing",
    "hankow", "wuhan", "hong kong", "canton", "guangzhou", "kweilin",
    "guilin", "liuchow", "liuzhou", "lingling", "hengyang", "changsha",
    "kunming", "chengdu", "chengtu", "chungking", "chongqing",
    # Indochina / SE Asia
    "indochina", "hanoi", "saigon", "bangkok", "singapore", "malaya",
    "penang", "rangoon", "burma", "mandalay", "myitkyina", "akyab",
    "palembang", "balikpapan", "soerabaja", "surabaya", "makassar",
    "celebes", "kendari", "amboina", "ambon", "borneo", "sumatra", "java",
    # Philippines
    "philippines", "luzon", "manila", "clark field", "cebu", "davao",
    "zamboanga", "leyte", "mindanao", "mindoro",
    # Pacific Islands
    "rabaul", "truk", "palau", "yap", "guam", "saipan", "tinian",
    "iwo jima", "chichi jima", "okinawa", "kiska", "attu", "aleutian",
    "paramushiru", "kuriles", "marcus", "nauru", "tarawa", "makin",
    "kwajalein", "eniwetok", "guadalcanal", "bougainville", "munda",
    "solomon", "new guinea", "rabaul", "lae", "wewak", "hollandia",
    "biak", "noemfoor", "wakde",
    # Aircraft types common in Pacific (helps catch ambiguous AF entries)
    "b-29", "superfortress",
]

PAGE_ARTIFACT_RE = re.compile(r"\s*===== PAGE \d+ =====\s*")

# ---------------------------------------------------------------------------
# Aircraft type → (altitude_ft, cruise_mph, display_type)
# ---------------------------------------------------------------------------
AIRCRAFT_PATTERNS = [
    (r'\bB-29[s]?\b',           31000, 220, "B-29 Superfortress"),
    (r'\bB-32[s]?\b',           30000, 300, "B-32 Dominator"),
    (r'\bB-17[s]?\b',           25000, 182, "B-17 Flying Fortress"),
    (r'\bB-24[s]?\b',           22000, 215, "B-24 Liberator"),
    (r'\bB-25[s]?\b',           15000, 230, "B-25 Mitchell"),
    (r'\bB-26[s]?\b',           15000, 240, "B-26 Marauder"),
    (r'\bA-20[s]?\b',           10000, 300, "A-20 Havoc"),
    (r'\bA-26[s]?\b',           15000, 320, "A-26 Invader"),
    (r'\bA-36[s]?\b',           15000, 322, "A-36 Apache"),
    (r'\bP-38[s]?\b',           20000, 275, "P-38 Lightning"),
    (r'\bP-39[s]?\b',           15000, 290, "P-39 Airacobra"),
    (r'\bP-40[s]?\b',           15000, 310, "P-40 Warhawk"),
    (r'\bP-47[s]?\b',           25000, 350, "P-47 Thunderbolt"),
    (r'\bP-51[s]?\b',           25000, 362, "P-51 Mustang"),
    (r'\bF-5A[s]?\b',           25000, 390, "F-5A Lightning"),
    (r'\bF6F[s]?\b|Hellcat',    15000, 350, "F6F Hellcat"),
    (r'\bF4U[s]?\b|Corsair',    20000, 340, "F4U Corsair"),
    (r'\bHB[s]?\b|heavy bomb',  25000, 200, "Heavy Bomber"),
    (r'\bMB[s]?\b|medium bomb', 15000, 230, "Medium Bomber"),
    (r'\bLB[s]?\b|light bomb',  10000, 280, "Light Bomber"),
    (r'\bftr[s]?\b',            20000, 320, "Fighter"),
    (r'\bKi-\d+\b',             20000, 310, "Ki Fighter"),
    (r'\bZero[s]?\b|A6M',       15000, 330, "A6M Zero"),
]

# ---------------------------------------------------------------------------
# Load bases
# ---------------------------------------------------------------------------
def load_bases():
    bases = []
    with open(BASES_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                bases.append({
                    "af":         row["af"],
                    "start":      datetime.strptime(row["start_date"], "%Y-%m-%d"),
                    "end":        datetime.strptime(row["end_date"], "%Y-%m-%d"),
                    "name":       row["base_name"],
                    "lat":        float(row["lat"]),
                    "lng":        float(row["lng"]),
                })
            except Exception:
                pass
    return bases


def get_base(af_name, date, bases):
    """Return (lat, lng, name) for the AF's primary base on a given date."""
    matches = [b for b in bases if b["af"] == af_name and b["start"] <= date <= b["end"]]
    if matches:
        return matches[0]["lat"], matches[0]["lng"], matches[0]["name"]
    # Fallback: closest AF match regardless of date
    af_bases = [b for b in bases if b["af"] == af_name]
    if af_bases:
        return af_bases[0]["lat"], af_bases[0]["lng"], af_bases[0]["name"]
    return None, None, None


# ---------------------------------------------------------------------------
# Load targets
# ---------------------------------------------------------------------------
def load_targets():
    targets = []
    with open(TARGETS_FILE, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                all_names = [row["name"].lower()] + [
                    a.strip().lower() for a in row.get("aliases", "").split(",") if a.strip()
                ]
                targets.append({
                    "primary": row["name"],
                    "names":   all_names,
                    "lat":     float(row["lat"]),
                    "lng":     float(row["lng"]),
                    "country": row.get("country", ""),
                    "type":    row.get("type", ""),
                })
            except Exception:
                pass
    return targets


def find_targets_in_text(text, targets, af_name=""):
    """Return list of target dicts mentioned in text (longest match first).
    Uses context-aware disambiguation for ambiguous names."""
    text_lower = text.lower()
    found = []
    seen = set()

    # Canton disambiguation: "Canton I" / "Canton Is" / "Canton |" = Canton Island
    # Otherwise Canton = Guangzhou (China)
    canton_island_pattern = re.search(r'canton\s*[i|I|]\b|canton\s+is\b', text_lower)
    is_pacific_af = af_name in ("Hawaiian AF", "Seventh AF")

    for tgt in sorted(targets, key=lambda t: -max(len(n) for n in t["names"])):
        for name in tgt["names"]:
            if len(name) >= 4 and name in text_lower and tgt["primary"] not in seen:
                # Disambiguation rules
                if tgt["primary"] == "Canton" and (canton_island_pattern or is_pacific_af):
                    # Skip Canton/Guangzhou — Canton Island will match instead
                    break
                if tgt["primary"] == "Canton Island" and not canton_island_pattern and not is_pacific_af:
                    # Skip Canton Island for CBI/China AFs unless explicitly mentioned
                    break

                found.append(tgt)
                seen.add(tgt["primary"])
                break
    return found


# ---------------------------------------------------------------------------
# Haversine distance (km)
# ---------------------------------------------------------------------------
def haversine(lat1, lng1, lat2, lng2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def estimate_duration(lat1, lng1, lat2, lng2, speed_mph):
    km = haversine(lat1, lng1, lat2, lng2)
    miles = km * 0.621371
    # Round trip + 10% for routing
    return round((miles * 2 / speed_mph) * 1.1, 1)


# ---------------------------------------------------------------------------
# Parse chronology entries
# ---------------------------------------------------------------------------
ENTRY_RE = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{2,4})\s+([\w\s]+?(?:AF|FEAF|USAMEAF|USAFFE|ZI|CCS|International|NAAF|NATAF|NASAF|USSTAF))\s*$',
    re.MULTILINE
)


def parse_entries(text):
    """Yield (date_str, af_name, body) tuples from the full chronology text."""
    # Strip page markers
    text = re.sub(r'={3,}\s*PAGE\s*\d+\s*={3,}', '', text)

    matches = list(ENTRY_RE.finditer(text))
    for i, m in enumerate(matches):
        date_str = m.group(1).strip()
        af_name  = m.group(2).strip()
        start    = m.end()
        end      = matches[i+1].start() if i+1 < len(matches) else len(text)
        body     = text[start:end].strip()
        yield date_str, af_name, body


def parse_date(date_str):
    """Parse M/D/YY or M/D/YYYY, return datetime or None.
    2-digit years are assumed to be 1940s (WWII era)."""
    for fmt in ("%m/%d/%y", "%m/%d/%Y"):
        try:
            d = datetime.strptime(date_str, fmt)
            # strptime with %y maps 00-68 → 2000-2068, 69-99 → 1969-1999
            # For this dataset all dates should be 1941-1945
            if d.year > 1945:
                d = d.replace(year=d.year - 100)
            return d
        except ValueError:
            pass
    return None


def is_east_asia(af_name, body):
    if af_name in EAST_ASIA_AFS:
        return True
    body_lower = body.lower()
    return any(kw in body_lower for kw in EAST_ASIA_KEYWORDS)


def extract_aircraft(body):
    """Return list of (display_type, altitude, speed) for aircraft mentioned."""
    found = []
    seen = set()
    for pattern, alt, spd, label in AIRCRAFT_PATTERNS:
        if re.search(pattern, body, re.IGNORECASE) and label not in seen:
            found.append((label, alt, spd))
            seen.add(label)
    return found or [("Unknown Aircraft", 20000, 250)]


def extract_aircraft_count(body, aircraft_type):
    """Extract number of aircraft from description for a specific aircraft type."""
    # First try exact type match (e.g., "9 B-17's")
    patterns = [
        rf'(\d+)\s+{re.escape(aircraft_type)}',
        rf'(\d+)\s+{aircraft_type.split()[0]}',  # e.g., "B-17" from "B-17 Flying Fortress"
    ]

    # Also try generic patterns near the type
    if 'B-29' in aircraft_type or 'Superfortress' in aircraft_type:
        patterns.extend([r'(\d+)\s+B-29', r'(\d+)\s+B-29s?'])
    elif 'B-17' in aircraft_type:
        patterns.extend([r'(\d+)\s+B-17', r'(\d+)\s+B-17s?'])
    elif 'P-51' in aircraft_type or 'Mustang' in aircraft_type:
        patterns.extend([r'(\d+)\s+P-51', r'(\d+)\s+Mustang'])
    elif 'P-40' in aircraft_type or 'Warhawk' in aircraft_type:
        patterns.extend([r'(\d+)\s+P-40', r'(\d+)\s+Warhawk'])
    elif 'P-38' in aircraft_type or 'Lightning' in aircraft_type:
        patterns.extend([r'(\d+)\s+P-38', r'(\d+)\s+Lightning'])
    elif 'F6F' in aircraft_type or 'Hellcat' in aircraft_type:
        patterns.extend([r'(\d+)\s+F6F', r'(\d+)\s+Hellcat'])
    elif 'Zero' in aircraft_type or 'A6M' in aircraft_type:
        patterns.extend([r'(\d+)\s+(?:Zero|A6M)'])
    elif 'Ki-' in aircraft_type or 'Oscar' in aircraft_type:
        patterns.extend([r'(\d+)\s+Ki-\d+', r'(\d+)\s+Oscar'])

    for pattern in patterns:
        m = re.search(pattern, body, re.IGNORECASE)
        if m:
            return int(m.group(1))

    # Fallback: if description mentions generic "aircraft" and type is singular, default to 1
    if 'Unknown' not in aircraft_type and 'Fighter' not in aircraft_type and not re.search(r'\d+\s+(?:aircraft|airplane|plane|bomber|fighter)', body, re.IGNORECASE):
        return 1

    return ""  # Empty if not found


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"Loading bases from {BASES_FILE}")
    bases = load_bases()
    print(f"  {len(bases)} base records")

    print(f"Loading targets from {TARGETS_FILE}")
    targets = load_targets()
    print(f"  {len(targets)} target records")

    print(f"Reading chronology from {CHRONO_FILE}")
    with open(CHRONO_FILE, encoding="utf-8") as f:
        text = f.read()

    rows = []
    skipped = 0
    total_entries = 0

    for date_str, af_name, body in parse_entries(text):
        total_entries += 1
        if not is_east_asia(af_name, body):
            skipped += 1
            continue

        date = parse_date(date_str)
        if date is None:
            continue

        origin_lat, origin_lng, base_name = get_base(af_name, date, bases)
        tgt_list = find_targets_in_text(body, targets, af_name)
        aircraft_list = extract_aircraft(body)

        # Remove OCR page markers before compacting whitespace for the CSV output.
        desc = PAGE_ARTIFACT_RE.sub(" ", body)
        desc = re.sub(r'\s+', ' ', desc).strip()
        # Keep full description — no truncation

        date_iso = date.strftime("%Y-%m-%dT06:00:00Z")  # default 0600 local
        date_tag  = date.strftime("%Y%m%d")
        af_tag    = re.sub(r'\s+', '', af_name).upper()

        # Emit one row per aircraft type — leave destination blank for manual fill
        for acft_idx, (acft_type, alt, spd) in enumerate(aircraft_list):
            if origin_lat is None:
                continue
            num_acft = extract_aircraft_count(body, acft_type)
            row_id = f"{af_tag}-{date_tag}-{acft_idx:02d}"
            rows.append({
                "id":             row_id,
                "squadron":       af_name,
                "type":           acft_type,
                "description":    desc,
                "start_lat":      origin_lat,
                "start_lng":      origin_lng,
                "end_lat":        "",
                "end_lng":        "",
                "start_time":     date_iso,
                "duration_hours": "",
                "altitude":       alt,
                "speed":          spd,
                "waypoints":      "",
                "origin_base":    base_name or "",
                "target_name":    "",
                "num_aircraft":   num_acft,
                "to_check":       "",
            })

    print(f"\nParsed {total_entries} chronology entries")
    print(f"  Skipped (non-East Asia): {skipped}")
    print(f"  East Asia entries kept: {total_entries - skipped}")
    print(f"  CSV rows generated:     {len(rows)}")

    fieldnames = [
        "id", "squadron", "type", "description",
        "start_lat", "start_lng", "end_lat", "end_lng",
        "start_time", "duration_hours", "altitude", "speed",
        "waypoints", "origin_base", "target_name", "num_aircraft",
        "to_check",
    ]

    with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nWrote {len(rows)} rows → {OUT_FILE}")


if __name__ == "__main__":
    main()
