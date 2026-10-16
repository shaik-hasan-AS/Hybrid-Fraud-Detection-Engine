import json
import os
import joblib
import numpy as np
import pandas as pd
import psycopg2
from sklearn.ensemble import IsolationForest

DB_CONFIG = {
    "dbname": os.environ.get("DB_NAME", "fraud_db"),
    "user": os.environ.get("DB_USER", "fraud_user"),
    "password": os.environ.get("DB_PASSWORD", "fraud_password"),
    "host": os.environ.get("DB_HOST", "localhost"),
    "port": os.environ.get("DB_PORT", "5433"),
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


def main():
    print("Connecting to DB and loading features...")
    conn = get_db_connection()

    query = """
    SELECT 
        transaction_id,
        amount,
        velocity_count,
        COALESCE(z_score, 0) as z_score,
        COALESCE(distance_km, 0) as distance_km,
        COALESCE(time_diff_hours, 0) as time_diff_hours,
        COALESCE(travel_speed_kmh, 0) as travel_speed_kmh,
        new_device_flag,
        COALESCE(micro_charge_count, 0) as micro_charge_count,
        category_change_flag,
        CAST(rule_foreign_transaction AS INT) as rule_foreign_transaction,
        CAST(rule_late_night AS INT) as rule_late_night
    FROM transaction_features
    """

    df = pd.read_sql(query, conn)
    conn.close()

    print(f"Loaded {len(df)} transactions.")

    feature_cols = [
        "amount",
        "velocity_count",
        "z_score",
        "travel_speed_kmh",
        "new_device_flag",
        "micro_charge_count",
        "category_change_flag",
        "rule_foreign_transaction",
        "rule_late_night",
    ]

    X = df[feature_cols].fillna(0)

    print("Training Isolation Forest model...")
    # 150 estimators for tree diversity
    model = IsolationForest(
        n_estimators=150,
        contamination=0.05,
        max_samples="auto",
        random_state=42,
    )
    model.fit(X)

    # Compute raw decision function scores
    raw_scores = model.decision_function(X)

    # Calculate calibrated percentile thresholds for smooth scaling
    min_score = float(np.percentile(raw_scores, 1))   # 1st percentile (extreme anomalies)
    median_score = float(np.median(raw_scores))       # Median of benign transactions
    max_score = float(np.percentile(raw_scores, 99))  # 99th percentile

    # Feature statistics for baseline SHAP-like attribution
    feature_medians = {col: float(X[col].median()) for col in feature_cols}
    feature_stds = {col: float(X[col].std() if X[col].std() > 0 else 1.0) for col in feature_cols}

    meta = {
        "feature_cols": feature_cols,
        "calibration": {
            "min_score": min_score,
            "median_score": median_score,
            "max_score": max_score,
        },
        "feature_medians": feature_medians,
        "feature_stds": feature_stds,
    }

    print("Saving calibrated model and metadata...")
    models_dir = os.path.join(os.path.dirname(__file__), "models")
    os.makedirs(models_dir, exist_ok=True)
    joblib.dump(model, os.path.join(models_dir, "isolation_forest.joblib"))
    with open(os.path.join(models_dir, "model_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print("Model and calibration metadata saved successfully.")



if __name__ == "__main__":
    main()
