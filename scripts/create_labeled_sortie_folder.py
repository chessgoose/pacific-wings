#!/usr/bin/env python3

import csv
import re
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "indiaburma1944-12th-bombardment-group-sortie-normalized.csv"
PHOTO_DIR = ROOT / "Oct1944" / "IndiaBurma1944Photos"
OUT_DIR = ROOT / "Oct1944" / "LabeledSorties"
MANIFEST_PATH = OUT_DIR / "manifest.csv"
README_PATH = OUT_DIR / "README.txt"


def slugify(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "unknown"


def safe_unlink(path: Path) -> None:
    if path.is_symlink() or path.exists():
        path.unlink()


def make_portrait_copy(target: Path, output_path: Path) -> bool:
    if not target.exists():
        return False
    safe_unlink(output_path)
    with Image.open(target) as image:
        image = ImageOps.exif_transpose(image)
        if image.width > image.height:
            image = image.rotate(90, expand=True)
        image.save(output_path, quality=95)
    return True


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rows = []
    with CSV_PATH.open(newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)

    manifest_rows = []
    for row in rows:
        sortie_id = row["sortie_id"]
        sortie_dir = OUT_DIR / sortie_id
        sortie_dir.mkdir(exist_ok=True)

        front_name = (row.get("source_front_image") or "").strip()
        back_name = (row.get("paired_back_candidate_by_rule") or "").strip()
        back_reviewed = (row.get("paired_back_reviewed") or "").strip()

        front_target = PHOTO_DIR / front_name if front_name else None
        back_target = PHOTO_DIR / back_name if back_name else None

        front_link_name = f"{sortie_id}__front__{slugify(front_name)}"
        back_prefix = "back_reviewed" if back_reviewed.lower() == "yes" else "back_candidate"
        back_link_name = f"{sortie_id}__{back_prefix}__{slugify(back_name)}"

        front_output = sortie_dir / front_link_name
        back_output = sortie_dir / back_link_name

        front_created = make_portrait_copy(front_target, front_output) if front_target else False
        back_created = make_portrait_copy(back_target, back_output) if back_target else False

        manifest_rows.append({
            "sortie_id": sortie_id,
            "report_date": row.get("report_date", ""),
            "squadron": row.get("squadron", ""),
            "primary_target": row.get("primary_target", ""),
            "front_image": front_name,
            "front_link": str(front_output.relative_to(OUT_DIR)) if front_created else "",
            "back_image": back_name,
            "back_reviewed": back_reviewed,
            "back_link": str(back_output.relative_to(OUT_DIR)) if back_created else ""
        })

    with MANIFEST_PATH.open("w", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "sortie_id",
                "report_date",
                "squadron",
                "primary_target",
                "front_image",
                "front_link",
                "back_image",
                "back_reviewed",
                "back_link",
            ],
        )
        writer.writeheader()
        writer.writerows(manifest_rows)

    README_PATH.write_text(
        "Labeled October 1944 sortie folders\n"
        "===================================\n\n"
        "Each subfolder is named for a parsed sortie ID from the October 1944 dataset.\n"
        "Inside each folder:\n"
        "- a labeled portrait-oriented copy of the front image\n"
        "- a labeled portrait-oriented copy of the paired back image when one is listed in the dataset\n\n"
        "These are copied from Oct1944/IndiaBurma1944Photos, so the labeled folder stays self-contained even if the raw archive folder is moved later.\n"
        "See manifest.csv for the full mapping.\n",
        encoding="utf-8",
    )

    print(f"Created labeled sortie folders for {len(rows)} sorties in {OUT_DIR}")


if __name__ == "__main__":
    main()
