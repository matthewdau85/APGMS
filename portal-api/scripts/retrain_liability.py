"""Trigger retraining when forecast errors exceed thresholds."""
from __future__ import annotations

import argparse

from forecasting import get_forecaster


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrain liability model based on error logs")
    parser.add_argument("--threshold", type=float, default=0.25, help="Error threshold (abs pct)")
    parser.add_argument("--window", type=int, default=7, help="Lookback window in days")
    args = parser.parse_args()

    forecaster = get_forecaster()
    updated = forecaster.retrain_from_errors(
        error_threshold=args.threshold,
        max_age_days=args.window,
    )

    if not updated:
        print("No retraining required")
    else:
        for abn, version in updated.items():
            print(f"Retrained {abn} -> {version}")


if __name__ == "__main__":
    main()
