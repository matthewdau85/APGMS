"""Utilities for short-term liability forecasting."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import json

import numpy as np
import pandas as pd
from pandas.tseries.offsets import MonthEnd
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX


@dataclass
class ForecastPoint:
    """Single horizon forecast output."""

    period: str
    point: float
    lo: Optional[float]
    hi: Optional[float]


@dataclass
class ForecastErrorLog:
    """Logged forecast error entry."""

    abn: str
    period: str
    actual: float
    forecast: float
    error: float
    abs_pct_error: float
    timestamp: str
    model_version: str


class LiabilityForecaster:
    """Forecast liabilities for BAS planning."""

    def __init__(
        self,
        data_path: Path,
        log_path: Path,
        error_log_path: Path,
        model_registry_path: Path,
    ) -> None:
        self.data_path = data_path
        self.log_path = log_path
        self.error_log_path = error_log_path
        self.model_registry_path = model_registry_path

        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.error_log_path.parent.mkdir(parents=True, exist_ok=True)
        self.model_registry_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.model_registry_path.exists():
            self._write_model_version("sarimax-0.1")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def forecast(
        self,
        abn: str,
        periods_ahead: int = 2,
        include_intervals: bool = True,
    ) -> List[ForecastPoint]:
        """Forecast the next N periods for a given ABN."""

        if periods_ahead < 1:
            raise ValueError("periods_ahead must be >= 1")
        periods_ahead = min(periods_ahead, 6)

        history = self._load_history(abn)
        if history.empty:
            raise ValueError(f"No liability history for ABN {abn}")

        feature_cols = ["payroll_events", "pos_turnover", "month_sin", "month_cos"]
        y = history["liability"].astype(float)
        exog = history[feature_cols].astype(float)

        future_periods = self._future_periods(history.index[-1], periods_ahead)
        future_exog = self._future_features(history, future_periods, feature_cols)

        model_version = self._read_model_version()

        try:
            sarimax_results = self._fit_sarimax(y, exog)
            fc = sarimax_results.get_forecast(steps=periods_ahead, exog=future_exog)
            mean = fc.predicted_mean
            if include_intervals:
                ci = fc.conf_int(alpha=0.2)
                lo = ci.iloc[:, 0]
                hi = ci.iloc[:, 1]
            else:
                lo = hi = pd.Series([np.nan] * periods_ahead, index=future_periods)
        except Exception:
            # Fallback to ETS when SARIMAX struggles
            ets_results = self._fit_ets(y)
            mean = ets_results.forecast(periods_ahead)
            resid = ets_results.resid
            resid_std = float(np.nanstd(resid)) if len(resid) else 0.0
            z = 1.2815515655446004  # 80% interval z-score
            if include_intervals:
                lo = mean - z * resid_std
                hi = mean + z * resid_std
            else:
                lo = hi = pd.Series([np.nan] * periods_ahead, index=future_periods)

        points = []
        for idx, period in enumerate(future_periods):
            period_label = period.strftime("%Y-%m")
            point_val = float(mean.iloc[idx])
            lo_val = float(lo.iloc[idx]) if include_intervals else None
            hi_val = float(hi.iloc[idx]) if include_intervals else None
            points.append(ForecastPoint(period_label, point_val, lo_val, hi_val))

        self._log_forecast(abn, points, model_version, periods_ahead)
        return points

    def log_actuals(self, abn: str, actuals: Iterable[Dict[str, float]]) -> List[ForecastErrorLog]:
        """Record realised liabilities and compute forecast error logs."""

        forecasts = self._load_json(self.log_path, default=[])
        errors = self._load_json(self.error_log_path, default=[])

        new_errors: List[ForecastErrorLog] = []
        now = datetime.utcnow().isoformat()

        for actual in actuals:
            period = str(actual["period"])
            actual_val = float(actual["actual"])
            forecast_match = self._find_latest_forecast(forecasts, abn, period)
            if not forecast_match:
                continue
            forecast_val = float(forecast_match["point"])
            error = actual_val - forecast_val
            denominator = actual_val if abs(actual_val) > 1e-6 else 1.0
            abs_pct = abs(error) / abs(denominator)
            entry = ForecastErrorLog(
                abn=abn,
                period=period,
                actual=actual_val,
                forecast=forecast_val,
                error=error,
                abs_pct_error=abs_pct,
                timestamp=now,
                model_version=forecast_match.get("model_version", "unknown"),
            )
            errors.append(entry.__dict__)
            new_errors.append(entry)

        self._save_json(self.error_log_path, errors)
        return new_errors

    def retrain_from_errors(
        self,
        *,
        max_age_days: int = 7,
        error_threshold: float = 0.25,
    ) -> Dict[str, str]:
        """Retrain models where recent errors exceed the threshold."""

        errors = self._load_json(self.error_log_path, default=[])
        if not errors:
            return {}

        cutoff = datetime.utcnow() - timedelta(days=max_age_days)
        retrain_abns: Dict[str, float] = {}
        for entry in errors:
            timestamp = datetime.fromisoformat(entry["timestamp"])
            if timestamp < cutoff:
                continue
            if entry["abs_pct_error"] > error_threshold:
                abn = entry["abn"] if "abn" in entry else "default"
                retrain_abns[abn] = max(entry["abs_pct_error"], retrain_abns.get(abn, 0))

        if not retrain_abns:
            return {}

        new_version = self._bump_model_version()
        result = {abn: new_version for abn in retrain_abns}
        return result

    def available_abns(self) -> List[str]:
        df = self._read_raw_history()
        return sorted(df["abn"].unique().tolist())

    def backtest(self, abn: str, horizon: int = 2) -> Dict[str, float]:
        """Simple backtest using the last `horizon` periods as holdout."""

        history = self._load_history(abn)
        if len(history) <= horizon + 3:
            raise ValueError("Not enough history for backtesting")

        feature_cols = ["payroll_events", "pos_turnover", "month_sin", "month_cos"]

        train = history.iloc[:-horizon]
        test = history.iloc[-horizon:]

        y_train = train["liability"].astype(float)
        exog_train = train[feature_cols].astype(float)
        y_test = test["liability"].astype(float)
        exog_test = test[feature_cols].astype(float)

        try:
            model = self._fit_sarimax(y_train, exog_train)
            fc = model.get_forecast(steps=horizon, exog=exog_test)
            preds = fc.predicted_mean
        except Exception:
            model = self._fit_ets(y_train)
            preds = model.forecast(horizon)

        actual = y_test.values
        forecast_vals = preds.values
        ape = np.abs((actual - forecast_vals) / np.where(actual == 0, 1.0, actual))
        mape = float(np.mean(ape) * 100)
        return {"mape": mape, "horizon": horizon, "points": len(history)}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _read_raw_history(self) -> pd.DataFrame:
        df = pd.read_csv(self.data_path)
        df["period"] = pd.PeriodIndex(df["period"], freq="M")
        return df

    def _load_history(self, abn: str) -> pd.DataFrame:
        df = self._read_raw_history()
        df = df[df["abn"] == abn].copy()
        if df.empty:
            return df
        df = df.sort_values("period")
        df["liability"] = df[["label_1a", "label_1b", "w2"]].sum(axis=1)
        df["month"] = df["period"].dt.month
        df["month_sin"] = np.sin(2 * np.pi * df["month"] / 12)
        df["month_cos"] = np.cos(2 * np.pi * df["month"] / 12)
        df.set_index("period", inplace=True)
        return df

    def _future_periods(self, last_period: pd.Period, steps: int) -> List[pd.Timestamp]:
        periods: List[pd.Timestamp] = []
        current = last_period.to_timestamp("M") + MonthEnd(1)
        for _ in range(steps):
            periods.append(current)
            current = current + MonthEnd(1)
        return periods

    def _future_features(
        self,
        history: pd.DataFrame,
        future_periods: List[pd.Timestamp],
        feature_cols: List[str],
    ) -> pd.DataFrame:
        last_values = history[feature_cols].tail(3)
        payroll_avg = float(last_values["payroll_events"].mean())

        pos_series = history["pos_turnover"].astype(float)
        if len(pos_series) >= 2:
            tail_len = min(6, len(pos_series))
            x = np.arange(tail_len)
            y = pos_series.tail(tail_len).values
            coeffs = np.polyfit(x, y, deg=1)
            slope, intercept = coeffs[0], coeffs[1]
            base_index = len(history) - tail_len
        else:
            slope, intercept = 0.0, float(pos_series.iloc[-1])
            base_index = len(history)

        future_rows = []
        for idx, ts in enumerate(future_periods, start=1):
            month = ts.month
            month_sin = np.sin(2 * np.pi * month / 12)
            month_cos = np.cos(2 * np.pi * month / 12)
            pay_events = payroll_avg
            x_val = base_index + idx
            pos_val = slope * x_val + intercept
            future_rows.append(
                {
                    "payroll_events": pay_events,
                    "pos_turnover": pos_val,
                    "month_sin": month_sin,
                    "month_cos": month_cos,
                }
            )

        future_df = pd.DataFrame(future_rows, index=future_periods)
        future_df = future_df.astype(float)
        return future_df

    def _fit_sarimax(self, y: pd.Series, exog: pd.DataFrame):
        model = SARIMAX(
            y,
            exog=exog,
            order=(1, 1, 1),
            seasonal_order=(0, 1, 1, 12),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        return model.fit(disp=False)

    def _fit_ets(self, y: pd.Series):
        model = ExponentialSmoothing(
            y,
            trend="add",
            seasonal="add",
            seasonal_periods=12,
        )
        return model.fit()

    def _log_forecast(
        self,
        abn: str,
        forecasts: List[ForecastPoint],
        model_version: str,
        horizon: int,
    ) -> None:
        payload = self._load_json(self.log_path, default=[])
        payload.append(
            {
                "abn": abn,
                "timestamp": datetime.utcnow().isoformat(),
                "model_version": model_version,
                "horizon": horizon,
                "forecasts": [
                    {
                        "period": point.period,
                        "point": point.point,
                        "lo": point.lo,
                        "hi": point.hi,
                        "model_version": model_version,
                    }
                    for point in forecasts
                ],
            }
        )
        self._save_json(self.log_path, payload)

    def _find_latest_forecast(self, logs: List[Dict], abn: str, period: str) -> Optional[Dict]:
        for entry in reversed(logs):
            if entry.get("abn") != abn:
                continue
            for forecast in entry.get("forecasts", []):
                if forecast.get("period") == period:
                    forecast["model_version"] = entry.get("model_version", "unknown")
                    forecast["abn"] = abn
                    return forecast
        return None

    def _load_json(self, path: Path, default):
        if not path.exists():
            return default
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _save_json(self, path: Path, payload) -> None:
        with path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)

    def _read_model_version(self) -> str:
        registry = self._load_json(self.model_registry_path, default={})
        return registry.get("liability", {}).get("version", "sarimax-0.1")

    def _write_model_version(self, version: str) -> None:
        payload = {
            "liability": {
                "version": version,
                "updated_at": datetime.utcnow().isoformat(),
            }
        }
        self._save_json(self.model_registry_path, payload)

    def _bump_model_version(self) -> str:
        base = "sarimax"
        new_version = f"{base}-{datetime.utcnow().strftime('%Y%m%dT%H%M%S')}"
        self._write_model_version(new_version)
        return new_version


_forecaster: Optional[LiabilityForecaster] = None


def get_forecaster() -> LiabilityForecaster:
    global _forecaster
    if _forecaster is None:
        root = Path(__file__).resolve().parent.parent
        data_path = root / "data" / "liability_history.csv"
        log_path = root / "data" / "forecast_log.json"
        error_log_path = root / "data" / "forecast_errors.json"
        model_registry_path = root / "data" / "model_registry.json"
        _forecaster = LiabilityForecaster(data_path, log_path, error_log_path, model_registry_path)
    return _forecaster
