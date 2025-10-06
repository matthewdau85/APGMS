"""Backtesting entry-point for the liability forecaster."""
from __future__ import annotations

import argparse

from forecasting import get_forecaster


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest the liability forecaster")
    parser.add_argument("abn", help="ABN to backtest", nargs="?", default="12345678901")
    parser.add_argument("--horizon", type=int, default=2, help="Holdout horizon")
    args = parser.parse_args()

    forecaster = get_forecaster()
    stats = forecaster.backtest(args.abn, horizon=args.horizon)
    print(
        "MAPE: {mape:.2f}% over horizon {horizon} (points={points})".format(
            **stats
        )
    )


if __name__ == "__main__":
    main()
