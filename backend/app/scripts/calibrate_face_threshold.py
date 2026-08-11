"""Evaluate candidate cosine thresholds from a consented labeled score CSV.

CSV columns: label,score where label is `genuine` or `impostor`. This tool reads
only similarity scores; it does not need or persist employee images/templates.
"""

import argparse
import csv
from pathlib import Path


def measurements(rows: list[tuple[str, float]], threshold: float) -> tuple[float, float]:
    genuine = [score for label, score in rows if label == "genuine"]
    impostor = [score for label, score in rows if label == "impostor"]
    if not genuine or not impostor:
        raise ValueError("The CSV must contain both genuine and impostor scores")
    false_reject_rate = sum(score < threshold for score in genuine) / len(genuine)
    false_accept_rate = sum(score >= threshold for score in impostor) / len(impostor)
    return false_accept_rate, false_reject_rate


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate the UniFace cosine match threshold")
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--minimum", type=float, default=0.20)
    parser.add_argument("--maximum", type=float, default=0.80)
    parser.add_argument("--step", type=float, default=0.01)
    args = parser.parse_args()
    with args.csv_file.open(newline="", encoding="utf-8") as handle:
        rows = [(row["label"].strip().lower(), float(row["score"])) for row in csv.DictReader(handle)]
    candidates = []
    threshold = args.minimum
    while threshold <= args.maximum + 1e-9:
        far, frr = measurements(rows, threshold)
        candidates.append((abs(far - frr), threshold, far, frr))
        threshold += args.step
    _, threshold, far, frr = min(candidates)
    print(f"Equal-error candidate: {threshold:.3f}")
    print(f"False accept rate: {far:.2%}")
    print(f"False reject rate: {frr:.2%}")
    print("Security and usability owners must approve the production threshold; this tool does not apply it.")


if __name__ == "__main__":
    main()
