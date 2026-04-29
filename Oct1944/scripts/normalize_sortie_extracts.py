import csv
import json
import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data" / "indiaburma1944-12th-bombardment-group-sortie-extracts.csv"
NORMALIZED = ROOT / "data" / "indiaburma1944-12th-bombardment-group-sortie-normalized.csv"
GEOJSON = ROOT / "data" / "indiaburma1944-12th-bombardment-group-sortie-map-data.geojson"
PLAYER_DATA = ROOT / "data" / "indiaburma1944-12th-bombardment-group-sortie-player-data.js"


COORD_RE = re.compile(
    r"(?P<lat_deg>\d{1,2})[° ](?P<lat_min>\d{1,2})[' ]?\s*(?P<lat_dir>[NS])"
    r"[, ]+\s*(?P<lon_deg>\d{1,3})[° ](?P<lon_min>\d{1,2})[' ]?\s*(?P<lon_dir>[EW])"
)

PLACE_POINTS = {
    "Fort White": (23.1615, 93.4419),
    "Prome": (18.8246, 95.2222),
    "Monywa": (22.1086, 95.1358),
    "Maymyo": (22.035, 96.4568),
    "Pyinmana": (19.7381, 96.2074),
    "Kalemyo": (23.1888, 94.0511),
    "Kalewa": (23.1914, 94.3011),
    "Kyaukse": (21.6056, 96.135),
    "Kennedy Peak": (20.754, 93.728),
    "Vital Corner": (20.93, 94.08),
    "Kutkai": (23.1889, 97.4389),
    "Mangshih": (24.4367, 98.5858),
    "Mangshi": (24.4367, 98.5858),
    "Myaungup": (18.8069, 94.5614),
    "Bawgyo": (22.633, 96.99),
    "Hsipaw": (22.62, 97.3),
    "Chaung-U": (21.95, 95.27),
    "Chaungu": (21.95, 95.27),
    "Thedaw": (20.38, 94.88),
    "Myittha": (20.85, 96.37),
    "Indainggyi": (22.93, 95.33),
    "Namsang": (20.8878, 97.7356),
    "Silchar": (24.8333, 92.7789),
}

APPROXIMATE_TARGET_POINTS = {}


def clean(text: str) -> str:
    return " ".join((text or "").replace("\n", " ").split()).strip()


def first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return clean(match.group(1)) if match else ""


def all_matches(pattern: str, text: str) -> str:
    matches = re.findall(pattern, text, flags=re.IGNORECASE)
    if not matches:
        return ""
    values = [clean(m if isinstance(m, str) else " ".join(m)) for m in matches]
    return " | ".join(v for v in values if v)


def clip_before(text: str, markers):
    lower = text.lower()
    end = len(text)
    for marker in markers:
        idx = lower.find(marker.lower())
        if idx != -1:
            end = min(end, idx)
    return clean(text[:end])


def parse_number(text: str) -> str:
    return first_match(r"(\d[\d,]*)", text).replace(",", "")


def dms_to_decimal(lat_deg: str, lat_min: str, lat_dir: str, lon_deg: str, lon_min: str, lon_dir: str):
    lat = int(lat_deg) + int(lat_min) / 60
    lon = int(lon_deg) + int(lon_min) / 60
    if lat_dir.upper() == "S":
        lat = -lat
    if lon_dir.upper() == "W":
        lon = -lon
    return round(lat, 6), round(lon, 6)


def extract_coordinates(*texts: str):
    seen = set()
    coords = []
    for text in texts:
        for match in COORD_RE.finditer(text or ""):
            lat, lon = dms_to_decimal(
                match.group("lat_deg"),
                match.group("lat_min"),
                match.group("lat_dir"),
                match.group("lon_deg"),
                match.group("lon_min"),
                match.group("lon_dir"),
            )
            key = (lat, lon)
            if key not in seen:
                seen.add(key)
                coords.append({"lat": lat, "lon": lon, "label": clean(match.group(0))})
    return coords


def is_non_route_coordinate(snippet: str):
    lower = clean(snippet).lower()
    branch_markers = [
        "turned home",
        "turned back",
        "left formation",
        "left the formation",
        "forced to leave",
        "returned to base",
        "landed at",
        "landed by",
        "diverted",
        "presumably for",
        "did not return",
        "engine trouble",
        "mechanical trouble",
        "weather trouble",
        "salvo",
        "jettison",
        "dropped bombs at",
    ]
    observation_markers = [
        "boat",
        "barge",
        "truck",
        "rail car",
        "rail cars",
        "fire",
        "smoke",
        "observed",
        "seen",
        "tied to the bank",
        "friendly aircraft",
    ]
    return any(marker in lower for marker in branch_markers + observation_markers)


def split_target(target: str):
    target = clean(target)
    primary = ""
    alternate = ""
    if "Primary:" in target:
        primary = first_match(r"Primary:\s*([^;]+)", target)
    if "alternate" in target.lower():
        alternate = first_match(r"alternate(?: target(?: bombed)?| No\. \d+| weather alternate)?:\s*([^;]+)", target)
    if not primary and ";" in target:
        primary = clean(target.split(";")[0])
    if not primary:
        primary = target
    return primary, alternate


def infer_place_point(*texts: str):
    for text in texts:
        cleaned = clean(text)
        lower = cleaned.lower()
        for place, coords in PLACE_POINTS.items():
            if place.lower() in lower:
                return {"lat": coords[0], "lon": coords[1], "label": place}
    return None


def extract_place_points(*texts: str):
    points = []
    seen = set()
    for text in texts:
        cleaned = clean(text)
        lower = cleaned.lower()
        found = []
        for place, coords in PLACE_POINTS.items():
            idx = lower.find(place.lower())
            if idx != -1:
                found.append((idx, place, coords))
        for _, place, coords in sorted(found, key=lambda item: item[0]):
            key = (round(coords[0], 6), round(coords[1], 6))
            if key in seen:
                continue
            seen.add(key)
            points.append({"lat": coords[0], "lon": coords[1], "label": place})
    return points


def parse_all_time_values(text: str):
    values = []
    for match in re.finditer(r"\b(\d{3,4})\b", text or ""):
        digits = match.group(1).zfill(4)
        values.append(f"{digits[:2]}:{digits[2:]}")
    return values


def parse_first_time_value(text: str):
    values = parse_all_time_values(text)
    return values[0] if values else ""


def iso_for_time(date_value: str, hhmm: str):
    if not date_value or not hhmm:
        return ""
    return f"{date_value}T{hhmm}:00Z"


def classify_event_text(text: str):
    lower = text.lower()
    if (
        "turned home" in lower
        or "turned back" in lower
        or "left formation" in lower
        or "left the formation" in lower
        or "diverted" in lower
        or "presumably for" in lower
        or "forced to leave" in lower
        or "engine trouble" in lower
        or "mechanical trouble" in lower
    ):
        return "breakoff"
    if "salvo" in lower or "jettison" in lower or "dropped bombs at" in lower:
        return "salvo"
    if "bombed" in lower or "bombing" in lower or "on target" in lower:
        return "bomb"
    if "takeoff" in lower or "depart" in lower:
        return "takeoff"
    if "land" in lower or "returned to base" in lower:
        return "landing"
    if "boat" in lower or "barge" in lower or "truck" in lower or "rail car" in lower or "rail cars" in lower:
        return "observation"
    if "flak" in lower or "aa" in lower or "anti-aircraft" in lower or "opposition" in lower:
        return "flak"
    return "observation"


def clean_sentence(text: str):
    text = clean(text)
    return text.rstrip(" .;")


def sentence_chunks(text: str):
    chunks = re.split(r"(?<=[.;])\s+", clean(text))
    return [chunk for chunk in chunks if chunk]


def snippet_for_label(label: str, *texts: str):
    snippets = []
    for text in texts:
        for chunk in sentence_chunks(text):
            if label in chunk:
                snippets.append(clean_sentence(chunk))
    if snippets:
        return " ".join(snippets[:2])
    return clean_sentence(" ".join(clean(t) for t in texts if t)[:240])


def parse_context_time(text: str):
    patterns = [
        r"\b(?:at|from|bombed at|landed at|turned back at|dropped bombs at|observed at)\s*(\d{3,4})\b",
        r"\b(\d{3,4})\s*hrs\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text or "", flags=re.IGNORECASE)
        if match:
            digits = match.group(1).zfill(4)
            return f"{digits[:2]}:{digits[2:]}"
    return ""


def shifted_point(point, direction: str, yards: int):
    meters = yards * 0.9144
    lat = point["lat"]
    lon = point["lon"]
    if direction == "north":
        lat += meters / 111320
    elif direction == "south":
        lat -= meters / 111320
    elif direction == "east":
        lon += meters / max(1e-6, 111320 * math.cos(math.radians(lat)))
    elif direction == "west":
        lon -= meters / max(1e-6, 111320 * math.cos(math.radians(lat)))
    return {"lat": lat, "lon": lon}


def build_event_points(row, points):
    events = []
    base = next((point for point in points if point["kind"] == "base"), None)
    base_return = next((point for point in reversed(points) if point["kind"] == "base_return"), base)
    targeted_place_labels = {point["label"] for point in extract_place_points(row["primary_target"], row["alternate_target"])}
    is_recovery_supplement = row["sortie_id"] == "81BS_1944-10-17_SUPP"

    if base:
        events.append({
            "kind": "takeoff",
            "label": "Takeoff",
            "description": f"Formation took off from {base['label']} at {row['time_up'] or 'unknown time'}.",
            "time": parse_first_time_value(row["time_up"]),
            "isoTime": iso_for_time(row["report_date"], parse_first_time_value(row["time_up"])),
            "lat": base["lat"],
            "lng": base["lon"],
        })

    target_label = row["alternate_target"] if row["target_status"] == "alternate attacked" and row["alternate_target"] else row["primary_target"]
    target_point = infer_place_point(target_label, row["route_summary"], row["special_remarks"])
    if not target_point:
        target_point = next((point for point in points if point["kind"] in {"coordinate", "approximate_target"}), None)
    bombing_time_text = parse_first_time_value(row["time_over_target"])
    if target_point and not is_recovery_supplement:
        events.append({
            "kind": "bomb",
            "label": "Target strike",
            "description": clean_sentence(target_label),
            "time": bombing_time_text,
            "isoTime": iso_for_time(row["report_date"], bombing_time_text),
            "lat": target_point["lat"],
            "lng": target_point["lon"],
        })
        short_drop = re.search(
            r"(\d+)(?:\s+bombs?)?\s+were\s+dropped\s+(\d+)\s+yards?\s+(north|south|east|west|n|s|e|w)\s+of target",
            row["special_remarks"] or "",
            flags=re.IGNORECASE,
        )
        if short_drop:
            direction = {
                "n": "north",
                "s": "south",
                "e": "east",
                "w": "west",
            }.get(short_drop.group(3).lower(), short_drop.group(3).lower())
            short_drop_point = shifted_point(target_point, direction, int(short_drop.group(2)))
            events.append({
                "kind": "bomb",
                "label": "Short of target",
                "description": clean_sentence(short_drop.group(0)),
                "time": bombing_time_text,
                "isoTime": iso_for_time(row["report_date"], bombing_time_text),
                "lat": short_drop_point["lat"],
                "lng": short_drop_point["lon"],
            })

    combined = " ".join([row["special_remarks"], row["observation_points_raw"], row["route_summary"]])
    for point in points:
        if point["kind"] not in {"coordinate", "event_coordinate"}:
            continue
        label = point["label"]
        if point["kind"] == "coordinate" and label in targeted_place_labels:
            continue
        snippet = snippet_for_label(label, row["special_remarks"], row["observation_points_raw"], row["route_summary"])
        if row["sortie_id"] == "81BS_1944-10-16" and label == "21 10 N 93 30 E":
            snippet = (
                "Aircraft #23 left the formation near 21 10 N 93 30 E because of weather, "
                "diverted to Silchar, and landed there at 1750"
            )
        if is_recovery_supplement and label == "21 10N, 93 30E":
            snippet = (
                "Aircraft #23 left the formation near 21 10N, 93 30E on 16 October because of weather, "
                "diverted to Silchar for the night, then took off from Silchar at 0745 and landed back at Feni at 0845 on 17 October"
            )
        time_value = parse_context_time(snippet)
        kind = classify_event_text(snippet)
        events.append({
            "kind": kind,
            "label": label,
            "description": snippet,
            "time": time_value,
            "isoTime": iso_for_time(row["report_date"], time_value),
            "lat": point["lat"],
            "lng": point["lon"],
        })

    opposition_text = clean_sentence(row["opposition_summary"])
    if opposition_text and target_point:
        events.append({
            "kind": "flak",
            "label": "Opposition",
            "description": opposition_text,
            "time": bombing_time_text,
            "isoTime": iso_for_time(row["report_date"], bombing_time_text),
            "lat": target_point["lat"],
            "lng": target_point["lon"],
        })

    if base_return:
        landing_time = parse_first_time_value(row["time_down"])
        events.append({
            "kind": "landing",
            "label": "Landing",
            "description": f"Formation landed at {base_return['label']} by {row['time_down'] or 'unknown time'}.",
            "time": landing_time,
            "isoTime": iso_for_time(row["report_date"], landing_time),
            "lat": base_return["lat"],
            "lng": base_return["lon"],
        })

    deduped = []
    seen = set()
    for event in events:
        key = (event["kind"], event["label"], event["lat"], event["lng"], event["time"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(event)
    return deduped


def derive_base_point(base: str):
    base = clean(base).lower()
    if "fenny" in base or "feni" in base:
        return 23.014, 91.397
    if "fenni" in base:
        return 23.014, 91.397
    if "comilla" in base:
        return 23.4607, 91.1809
    if "fenny a/d" in base:
        return 23.014, 91.397
    if "tiddim" in base:
        return 23.3787, 93.6580
    return None


def derive_start_and_return_base_points(row, route_summary: str, observations: str):
    sortie_id = clean(row["sortie_id"])
    base_label = clean(row["base"])
    default_base = derive_base_point(base_label)
    if sortie_id == "81BS_1944-10-17_SUPP":
        start_point = PLACE_POINTS.get("Silchar")
        return_point = derive_base_point("Feni")
        return (
            (start_point[0], start_point[1], "Silchar") if start_point else None,
            (return_point[0], return_point[1], "Feni") if return_point else None,
        )
    if default_base:
        return (
            (default_base[0], default_base[1], base_label),
            (default_base[0], default_base[1], base_label),
        )
    return None, None


def extract_rows():
    with SOURCE.open(newline="") as handle:
        return list(csv.DictReader(handle))


def normalize_row(row):
    target = clean(row["target"])
    route_note = clean(row["route_note"])
    special = clean(row["special_remarks"])
    observations = clean(row["observation_point"])
    primary_target, alternate_target = split_target(target)

    coord_mentions = extract_coordinates(route_note, observations, special, target)
    coords = []
    event_coords = []
    for coord in coord_mentions:
        snippet = snippet_for_label(coord["label"], route_note, observations, special, target)
        if is_non_route_coordinate(snippet):
            event_coords.append(coord)
        else:
            coords.append(coord)

    place_points = extract_place_points(primary_target, alternate_target, route_note, observations)
    if len(coords) < 3:
        for place_point in place_points:
            key = (round(place_point["lat"], 6), round(place_point["lon"], 6))
            existing_route = {(round(coord["lat"], 6), round(coord["lon"], 6)) for coord in coords}
            existing_event = {(round(coord["lat"], 6), round(coord["lon"], 6)) for coord in event_coords}
            if key in existing_route or key in existing_event:
                continue
            coords.append(place_point)

    lead_aircraft = first_match(r"Leading (?:Plane|Aircraft)\s*#?(\d+)", special) or first_match(
        r"lead(?:ing)? (?:plane|aircraft)(?: was)?\s*#?(\d+)", route_note + " " + special
    )
    oprep_ref = first_match(r"OpRep(?: Ref\. No\.)?\s*([A-Za-z0-9-]+)", special)
    bombs_carried = first_match(r"Bomb(?: load)?s? carried(?: on takeoff)?[: ]+([^.;]+)", special)
    if not bombs_carried:
        bombs_carried = first_match(r"Bomb load:\s*\(Carried\)\s*([^.;]+)", special)
    if not bombs_carried:
        bombs_carried = first_match(r"Bomb load carried and on target:\s*([^.;]+)", special)

    bombs_on_target = first_match(r"Bomb(?: load)?s? (?:on target|dropped on target|dropped)[: ]+([^.;]+)", special)
    if not bombs_on_target:
        bombs_on_target = first_match(r"Bomb load:\s*\(On target\)\s*([^.;]+)", special)
    if not bombs_on_target:
        bombs_on_target = first_match(r"Bomb load carried and on target:\s*([^.;]+)", special)

    bombs_salvoed = first_match(r"Bomb(?: load)?s? (?:jettisoned|salvoed)[: ]+([^.;]+)", special)
    if not bombs_salvoed:
        bombs_salvoed = first_match(r"(\d+\s*x\s*[^.;]*?\bsalvoed\b[^.;]*)", special)

    bombs_returned = first_match(r"Bomb(?: load)?s? (?:brought back|returned to base|returned)[: ]+([^.;]+)", special)
    if not bombs_returned:
        bombs_returned = first_match(r"(\d+\s*x\s*[^.;]*?\bbrought back\b[^.;]*)", special)
    ammo_expended = first_match(r"Ammunition Expended[: ]+([^.;]+)", special) or first_match(
        r"Ammo expended[: ]+([^.;]+)", special
    )
    bombing_course = all_matches(r"(?:Bomb(?:ing)?(?: run)?(?: course)?(?: was| were| on)?(?: listed by element as)?)[^.;]*?(\d{1,3}\s*degrees?)", route_note + " " + special)
    if not bombing_course:
        bombing_course = all_matches(r"\bcourse(?: was| were)?\s*(\d{1,3}\s*degrees?)", route_note + " " + special)

    speed_source = clip_before(route_note + " " + special, ["Opposition:", "Casualties:", "Photos:", "Photographs", "Observations:", "Leaflets dropped:"])
    bombing_speed = all_matches(r"(\d{2,3}\s*(?:IAS|MPH))", speed_source)
    bombing_altitude = all_matches(r"(\d{3,5}\s*feet(?: indicated)?(?!\s*interval)|\d{3,5}'\s*Ind\.?)", speed_source)
    interval_setting = first_match(r"interval(?:ometer)?(?: setting)?(?: was| were)?\s*([0-9 -]+(?:feet|ft))", route_note + " " + special)
    if not interval_setting:
        interval_setting = first_match(r"with\s*([0-9 -]+(?:feet|ft))\s*interval", route_note + " " + special)

    opposition = first_match(r"Opposition[: ]+([^.;]+(?:\.[^.;]+)?)", special)
    casualties = first_match(r"Casualties[: ]+([^.;]+)", special)
    photos = first_match(r"Photos?[: ]+([^.;]+)", special)
    if not photos:
        photos = first_match(r"Photographs? (?:were obtained|were taken)([^.;]+)", special)
    photos = clip_before(photos, ["Leaflets dropped", "Observations:", "Observation:", "One river boat", "Heavy billowing"])

    leaflet_drops = first_match(r"Leaflets dropped[: ]+([^.;]+)", special) or first_match(
        r"(\d[\d,]*\s*(?:x\s*)?[A-Z/0-9 ,.-]*propaganda leaflets[^.;]*)", special
    )
    leaflet_drops = clip_before(leaflet_drops, ["Ammunition expended", "Results:", "Opposition:", "Casualties:"])
    results = first_match(r"Results[: ]+([^.;]+(?:\.[^.;]+){0,2})", special)
    weather = first_match(r"Weather[: ]+([^.;]+(?:\.[^.;]+){0,4})", special)
    map_reference = first_match(r"Map references?[: ]+([^.;]+)", special)

    route_summary = route_note
    target_status = ""
    if "alternate" in route_note.lower() or "alternate" in target.lower():
        target_status = "alternate attacked"
    elif "primary target was overcast" in route_note.lower():
        target_status = "primary obscured"
    elif "direct to target" in route_note.lower():
        target_status = "primary attacked"

    start_base_point, return_base_point = derive_start_and_return_base_points(row, route_note, observations)
    map_points = []
    if start_base_point:
        map_points.append({"kind": "base", "lat": start_base_point[0], "lon": start_base_point[1], "label": start_base_point[2]})
    if not coords:
        inferred_target = infer_place_point(primary_target, alternate_target, route_note, observations, special)
        if inferred_target:
            coords.append(inferred_target)
    if not coords and row["sortie_id"] in APPROXIMATE_TARGET_POINTS:
        lat, lon, label = APPROXIMATE_TARGET_POINTS[row["sortie_id"]]
        map_points.append({"kind": "approximate_target", "lat": lat, "lon": lon, "label": label})
    for coord in coords:
        map_points.append({"kind": "coordinate", **coord})
    for coord in event_coords:
        map_points.append({"kind": "event_coordinate", **coord})
    if return_base_point and any(point["kind"] != "base" for point in map_points):
        map_points.append({"kind": "base_return", "lat": return_base_point[0], "lon": return_base_point[1], "label": return_base_point[2]})

    return {
        "sortie_id": row["sortie_id"],
        "report_date": row["report_date"],
        "unit": row["unit"],
        "squadron": row["squadron"],
        "source_front_image": row["source_front_image"],
        "paired_back_candidate_by_rule": row["paired_back_candidate_by_rule"],
        "paired_back_reviewed": row["paired_back_reviewed"],
        "aircraft_type": row["aircraft_type"],
        "aircraft_count": row["aircraft_count"],
        "base": row["base"],
        "oprep_ref": oprep_ref,
        "lead_aircraft": lead_aircraft,
        "primary_target": primary_target,
        "alternate_target": alternate_target,
        "target_status": target_status,
        "time_up": row["time_up"],
        "time_over_target": row["time_over_target"],
        "time_down": row["time_down"],
        "route_summary": route_summary,
        "observation_points_raw": observations,
        "map_reference": map_reference,
        "weather_summary": weather,
        "bomb_load_carried": bombs_carried,
        "bombs_on_target": bombs_on_target,
        "bombs_salvoed_or_jettisoned": bombs_salvoed,
        "bombs_returned": bombs_returned,
        "bombing_course": bombing_course,
        "bombing_speed": bombing_speed,
        "bombing_altitude": bombing_altitude,
        "bombing_interval": interval_setting,
        "ammo_expended": ammo_expended,
        "results_summary": results,
        "opposition_summary": opposition,
        "casualties": casualties,
        "photo_aircraft": photos,
        "leaflet_drops": leaflet_drops,
        "special_remarks": special,
        "coordinate_count": str(len(coord_mentions)),
        "confidence": row["confidence"],
        "map_points_json": json.dumps(map_points),
    }


def parse_time_value(date_value: str, time_value: str):
    date_value = clean(date_value)
    time_value = clean(time_value)
    if not date_value or not time_value:
        return None
    match = re.search(r"(\d{3,4})", time_value)
    if not match:
        return None
    digits = match.group(1).zfill(4)
    return f"{date_value}T{digits[:2]}:{digits[2:]}:00Z"


def slugify(value: str) -> str:
    value = clean(value)
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "unknown"


def build_scan_path(sortie_id: str, filename: str, kind: str) -> str:
    filename = clean(filename)
    if not sortie_id or not filename:
        return ""
    relative = f"./LabeledSorties/{sortie_id}/{sortie_id}__{kind}__{slugify(filename)}"
    absolute = ROOT / "Oct1944" / relative.replace("./", "", 1)
    return relative if absolute.exists() else ""


def build_player_missions(rows):
    missions = []
    for row in rows:
        points = json.loads(row["map_points_json"])
        if len(points) < 2:
            continue

        start_iso = parse_time_value(row["report_date"], row["time_up"])
        end_iso = parse_time_value(row["report_date"], row["time_down"])
        if not start_iso or not end_iso:
            start_iso = f"{row['report_date']}T08:00:00Z"
            end_iso = f"{row['report_date']}T12:00:00Z"

        confidence = row["confidence"].split(";")[0]
        event_points = build_event_points(row, points)
        has_reviewed_back = row["paired_back_reviewed"] == "yes"

        missions.append({
            "id": row["sortie_id"],
            "date": row["report_date"],
            "squadron": row["squadron"],
            "unit": row["unit"],
            "aircraftType": row["aircraft_type"],
            "aircraftCount": row["aircraft_count"],
            "base": row["base"],
            "sourceFront": row["source_front_image"],
            "sourceBack": row["paired_back_candidate_by_rule"] if has_reviewed_back else "",
            "scanFrontPath": build_scan_path(row["sortie_id"], row["source_front_image"], "front"),
            "scanBackPath": build_scan_path(
                row["sortie_id"],
                row["paired_back_candidate_by_rule"] if has_reviewed_back else "",
                "back_reviewed",
            ),
            "confidence": confidence,
            "primaryTarget": row["primary_target"],
            "alternateTarget": row["alternate_target"],
            "targetStatus": row["target_status"],
            "timeUp": row["time_up"],
            "timeOverTarget": row["time_over_target"],
            "timeDown": row["time_down"],
            "routeSummary": row["route_summary"],
            "weatherSummary": row["weather_summary"],
            "bombLoadCarried": row["bomb_load_carried"],
            "bombsOnTarget": row["bombs_on_target"],
            "bombsSalvoed": row["bombs_salvoed_or_jettisoned"],
            "bombsReturned": row["bombs_returned"],
            "bombingCourse": row["bombing_course"],
            "bombingSpeed": row["bombing_speed"],
            "bombingAltitude": row["bombing_altitude"],
            "bombingInterval": row["bombing_interval"],
            "ammoExpended": row["ammo_expended"],
            "opposition": row["opposition_summary"],
            "casualties": row["casualties"],
            "photos": row["photo_aircraft"],
            "leaflets": row["leaflet_drops"],
            "results": row["results_summary"],
            "observations": row["observation_points_raw"],
            "startIso": start_iso,
            "endIso": end_iso,
            "points": points,
            "eventPoints": event_points,
        })
    return missions


def build_geojson(rows):
    features = []
    for row in rows:
        map_points = json.loads(row["map_points_json"])
        line_coords = [[p["lon"], p["lat"]] for p in map_points]
        if len(line_coords) >= 2:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": line_coords},
                    "properties": {
                        "sortie_id": row["sortie_id"],
                        "report_date": row["report_date"],
                        "squadron": row["squadron"],
                        "primary_target": row["primary_target"],
                        "alternate_target": row["alternate_target"],
                        "target_status": row["target_status"],
                        "confidence": row["confidence"],
                    },
                }
            )
        for point in map_points:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [point["lon"], point["lat"]]},
                    "properties": {
                        "sortie_id": row["sortie_id"],
                        "report_date": row["report_date"],
                        "squadron": row["squadron"],
                        "kind": point["kind"],
                        "label": point["label"],
                        "confidence": row["confidence"],
                    },
                }
            )
    return {"type": "FeatureCollection", "features": features}


def main():
    source_rows = extract_rows()
    normalized_rows = [normalize_row(row) for row in source_rows]

    fieldnames = list(normalized_rows[0].keys())
    with NORMALIZED.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(normalized_rows)

    GEOJSON.write_text(json.dumps(build_geojson(normalized_rows), indent=2))
    player_data = {
        "generated_from": SOURCE.name,
        "mission_count": len(normalized_rows),
        "missions": build_player_missions(normalized_rows),
    }
    PLAYER_DATA.write_text("window.MONTH_SORTIE_DATA = " + json.dumps(player_data, indent=2) + ";\n")
    print(f"normalized_rows {len(normalized_rows)}")
    print(f"normalized_csv {NORMALIZED}")
    print(f"geojson {GEOJSON}")
    print(f"player_data {PLAYER_DATA}")


if __name__ == "__main__":
    main()
