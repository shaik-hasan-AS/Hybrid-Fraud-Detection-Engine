import asyncio
import json
import os
import random
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

DB_CONFIG = {
    "dbname": os.environ.get("DB_NAME", "fraud_db"),
    "user": os.environ.get("DB_USER", "fraud_user"),
    "password": os.environ.get("DB_PASSWORD", "fraud_password"),
    "host": os.getenv("DB_HOST", "localhost"),
    "port": os.getenv("DB_PORT", "5433"),
}

# Thread-safe database connection pool
db_pool: ThreadedConnectionPool | None = None


def init_db_pool():
    global db_pool
    if db_pool is None:
        db_pool = ThreadedConnectionPool(minconn=2, maxconn=20, **DB_CONFIG)


def close_db_pool():
    global db_pool
    if db_pool is not None:
        db_pool.closeall()
        db_pool = None


@contextmanager
def get_db_connection():
    """Context manager to yield a pooled DB connection and safely return it."""
    global db_pool
    if db_pool is None:
        init_db_pool()
    conn = db_pool.getconn()
    try:
        yield conn
    finally:
        db_pool.putconn(conn)


# WebSocket Connection Manager for real-time live streaming
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.append(connection)
        for dc in dead_connections:
            self.disconnect(dc)


ws_manager = ConnectionManager()


# Load the ML model and calibration metadata
model_path = os.path.join(
    os.path.dirname(__file__), "../ml/models/isolation_forest.joblib"
)
meta_path = os.path.join(
    os.path.dirname(__file__), "../ml/models/model_meta.json"
)

try:
    ml_model = joblib.load(model_path)
except Exception as e:
    print(f"Warning: Could not load ML model: {e}")
    ml_model = None

model_meta = None
if os.path.exists(meta_path):
    try:
        with open(meta_path, "r") as f:
            model_meta = json.load(f)
    except Exception as e:
        print(f"Warning: Could not load model meta: {e}")

ML_FEATURE_COLS = [
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


def compute_ml_scores(df_or_dicts):
    """Calibrated ML risk score computation (0-100 scale).
    Uses percentile thresholds from training metadata to produce smooth continuous risk distributions.
    """
    if ml_model is None or not df_or_dicts:
        return [0] * len(df_or_dicts)

    feat_df = pd.DataFrame(df_or_dicts).fillna(0)
    for col in ML_FEATURE_COLS:
        if col not in feat_df.columns:
            feat_df[col] = 0

    X = feat_df[ML_FEATURE_COLS]
    raw_scores = ml_model.decision_function(X)

    if model_meta and "calibration" in model_meta:
        cal = model_meta["calibration"]
        min_s = cal.get("min_score", -0.15)
        med_s = cal.get("median_score", 0.08)

        # Smooth piecewise linear scaling:
        # If raw_score <= min_s -> 100 risk
        # If raw_score >= med_s -> 0 risk
        # In between -> linear interpolation
        span = max(1e-6, med_s - min_s)
        normalized = (med_s - raw_scores) / span
        risk_scores = np.clip(normalized * 100, 0, 100).astype(int)
    else:
        # Fallback calibrated clipping
        risk_scores = np.clip(raw_scores * -1000, 0, 100).astype(int)

    return risk_scores.tolist()


def explain_ml_anomaly(tx_dict: dict) -> list[dict]:
    """Generates feature importance attribution explaining why the ML model flagged a transaction."""
    if not model_meta or "feature_medians" not in model_meta:
        # Standard fallback attribution
        return [
            {"feature": "Amount", "contribution": 35, "description": f"Charge of ${tx_dict.get('amount', 0):,.2f}"},
            {"feature": "Velocity Count", "contribution": 25, "description": f"{tx_dict.get('velocity_count', 0)} charges in 2 mins"},
            {"feature": "Travel Speed", "contribution": 20, "description": f"{tx_dict.get('travel_speed_kmh', 0):.1f} km/h velocity"},
        ]

    medians = model_meta["feature_medians"]
    stds = model_meta.get("feature_stds", {})

    contributions = []
    labels = {
        "amount": "Transaction Amount",
        "velocity_count": "Velocity Burst",
        "z_score": "Spend Z-Score",
        "travel_speed_kmh": "Travel Speed",
        "new_device_flag": "New Device Usage",
        "micro_charge_count": "Micro-Charge Testing",
        "category_change_flag": "Category Jump",
        "rule_foreign_transaction": "Cross-Border Location",
        "rule_late_night": "Off-Hour Timestamp",
    }

    for col in ML_FEATURE_COLS:
        val = float(tx_dict.get(col) or 0)
        med = medians.get(col, 0)
        std = stds.get(col, 1.0)
        diff = max(0.0, (val - med) / std) if std > 0 else 0.0

        if diff > 0.3:
            contributions.append({
                "feature": labels.get(col, col),
                "weight": round(diff, 2),
                "value": val,
            })

    contributions.sort(key=lambda x: x["weight"], reverse=True)
    top_contributors = contributions[:4]

    total_w = sum(c["weight"] for c in top_contributors) or 1.0
    return [
        {
            "feature": c["feature"],
            "impact_pct": int((c["weight"] / total_w) * 100),
            "value": c["value"],
        }
        for c in top_contributors
    ]


async def simulate_live_transactions():
    """Background task to insert realistic live transactions and stream to WebSocket clients."""
    print("Starting live transaction simulator...")
    while True:
        await asyncio.sleep(random.randint(2, 6))  # New transaction every 2-6 seconds
        try:
            new_tx_id = str(uuid.uuid4())
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    # Fetch a random active card and its customer country
                    cur.execute("""
                        SELECT c.card_id, c.account_id, cust.country 
                        FROM cards c
                        JOIN accounts a ON c.account_id = a.account_id
                        JOIN customers cust ON a.customer_id = cust.customer_id
                        ORDER BY RANDOM() LIMIT 1
                    """)
                    card = cur.fetchone()

                    if card and random.random() < 0.90:
                        cur.execute(
                            "SELECT merchant_id, latitude, longitude, country, category FROM merchants WHERE country = %s ORDER BY RANDOM() LIMIT 1",
                            (card[2],),
                        )
                    else:
                        cur.execute(
                            "SELECT merchant_id, latitude, longitude, country, category FROM merchants ORDER BY RANDOM() LIMIT 1"
                        )
                    merchant = cur.fetchone()

                    cur.execute("SELECT device_id FROM devices ORDER BY RANDOM() LIMIT 1")
                    device = cur.fetchone()

                    if card and merchant and device:
                        is_anomaly = random.random() < 0.05
                        category = merchant[4]

                        cat_mu = 4.0
                        cat_sigma = 0.6
                        if category == "Coffee Shop":
                            cat_mu, cat_sigma = 1.5, 0.5
                        elif category == "Fast Food":
                            cat_mu, cat_sigma = 2.5, 0.5
                        elif category == "Electronics":
                            cat_mu, cat_sigma = 5.8, 0.8
                        elif category == "Travel":
                            cat_mu, cat_sigma = 6.2, 0.7

                        amount = (
                            round(random.uniform(90000.0, 95000.0), 2)
                            if is_anomaly
                            else round(max(1.0, float(np.random.lognormal(cat_mu, cat_sigma))), 2)
                        )

                        cur.execute(
                            """
                            INSERT INTO transactions 
                            (transaction_id, account_id, card_id, merchant_id, device_id, timestamp, amount, currency, latitude, longitude, country, ip_address, payment_method, status)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                new_tx_id,
                                card[1],
                                card[0],
                                merchant[0],
                                device[0],
                                datetime.now(),
                                amount,
                                "USD",
                                merchant[1],
                                merchant[2],
                                merchant[3],
                                "192.168.1.1",
                                "Card",
                                "SUCCESS",
                            ),
                        )
                        conn.commit()

                    # Query the evaluated features for the new transaction to broadcast live
                    evaluated_tx = None
                    if card and merchant and device:
                        with conn.cursor(cursor_factory=RealDictCursor) as eval_cur:
                            eval_cur.execute(
                                """
                                SELECT 
                                    transaction_id, account_id, merchant_id, timestamp, amount, 
                                    sql_risk_score, rule_high_velocity, rule_amount_anomaly, 
                                    rule_impossible_travel, rule_new_device,
                                    rule_foreign_transaction, rule_late_night,
                                    rule_micro_testing, rule_rapid_category_hopping,
                                    velocity_count, z_score, travel_speed_kmh, new_device_flag,
                                    micro_charge_count, category_change_flag
                                FROM transaction_features
                                WHERE transaction_id = %s
                                """,
                                (new_tx_id,),
                            )
                            evaluated_tx = eval_cur.fetchone()

            if evaluated_tx:
                evaluated_tx = dict(evaluated_tx)
                if ml_model:
                    ml_score = compute_ml_scores([evaluated_tx])[0]
                    evaluated_tx["ml_risk_score"] = ml_score
                    evaluated_tx["hybrid_risk_score"] = int(
                        (evaluated_tx["sql_risk_score"] * 0.6) + (ml_score * 0.4)
                    )
                else:
                    evaluated_tx["ml_risk_score"] = 0
                    evaluated_tx["hybrid_risk_score"] = evaluated_tx["sql_risk_score"]

                if isinstance(evaluated_tx.get("timestamp"), datetime):
                    evaluated_tx["timestamp"] = evaluated_tx["timestamp"].isoformat()

                # Broadcast to connected WebSocket clients
                await ws_manager.broadcast({
                    "type": "NEW_TRANSACTION",
                    "data": evaluated_tx
                })
                print(f"Live Simulation: Inserted & broadcast {amount} USD (Risk: {evaluated_tx['hybrid_risk_score']})")

        except Exception as e:
            print(f"Simulation error: {e}")


from pydantic import BaseModel, Field

# Case management action payload
class CaseActionRequest(BaseModel):
    action: str = Field(..., description="Action taken: BLOCK_CARD, FALSE_POSITIVE, REQUEST_KYC, or RESOLVED")
    analyst_notes: str = Field(default="", description="Audit notes from the analyst")
    resolved_by: str = Field(default="analyst_1", description="Identifier of the resolving analyst")


def init_db_schema_extensions():
    """Ensure fraud_actions audit table exists dynamically."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS fraud_actions (
                    action_id VARCHAR(50) PRIMARY KEY,
                    transaction_id VARCHAR(50) REFERENCES transactions(transaction_id),
                    action VARCHAR(50) NOT NULL,
                    analyst_notes TEXT,
                    resolved_by VARCHAR(50) DEFAULT 'analyst_1',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_fraud_actions_tx ON fraud_actions(transaction_id);
                CREATE INDEX IF NOT EXISTS idx_fraud_actions_created ON fraud_actions(created_at);
            """)
            conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db_pool()
    try:
        init_db_schema_extensions()
    except Exception as e:
        print(f"Schema check error: {e}")
    sim_task = asyncio.create_task(simulate_live_transactions())
    yield
    sim_task.cancel()
    close_db_pool()


app = FastAPI(title="Fraud Detection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket):
    """Real-time streaming channel for live transaction events."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection open; receive ping or client messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


@app.get("/transactions")
def get_transactions(limit: int = 100, offset: int = 0, sort_by_risk: bool = True):
    order_clause = (
        "ORDER BY sql_risk_score DESC, timestamp DESC"
        if sort_by_risk
        else "ORDER BY timestamp DESC"
    )

    # Single-pass query: fetches presentation fields and ML feature columns in one round-trip
    query = f"""
        SELECT 
            transaction_id, account_id, merchant_id, timestamp, amount, 
            sql_risk_score, rule_high_velocity, rule_amount_anomaly, 
            rule_impossible_travel, rule_new_device,
            rule_foreign_transaction, rule_late_night,
            rule_micro_testing, rule_rapid_category_hopping,
            velocity_count, z_score, travel_speed_kmh, new_device_flag,
            micro_charge_count, category_change_flag
        FROM transaction_features
        {order_clause}
        LIMIT %s OFFSET %s
    """

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (limit, offset))
            transactions = cur.fetchall()

    if ml_model and transactions:
        ml_scores = compute_ml_scores(transactions)
        for t, ml_score in zip(transactions, ml_scores):
            t["ml_risk_score"] = ml_score
            t["hybrid_risk_score"] = int((t["sql_risk_score"] * 0.6) + (ml_score * 0.4))
    else:
        for t in transactions:
            t["ml_risk_score"] = 0
            t["hybrid_risk_score"] = t["sql_risk_score"]

    return transactions


@app.get("/analytics/summary")
def get_analytics_summary():
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COUNT(*) as total_transactions,
                    SUM(CASE WHEN sql_risk_score >= 60 THEN 1 ELSE 0 END) as high_risk_transactions,
                    SUM(CASE WHEN rule_high_velocity THEN 1 ELSE 0 END) as velocity_flags,
                    SUM(CASE WHEN rule_amount_anomaly THEN 1 ELSE 0 END) as amount_flags,
                    SUM(CASE WHEN rule_impossible_travel THEN 1 ELSE 0 END) as travel_flags,
                    SUM(CASE WHEN rule_new_device THEN 1 ELSE 0 END) as device_flags,
                    SUM(CASE WHEN rule_foreign_transaction THEN 1 ELSE 0 END) as foreign_flags,
                    SUM(CASE WHEN rule_late_night THEN 1 ELSE 0 END) as late_night_flags,
                    SUM(CASE WHEN rule_micro_testing THEN 1 ELSE 0 END) as micro_flags,
                    SUM(CASE WHEN rule_rapid_category_hopping THEN 1 ELSE 0 END) as hopping_flags
                FROM transaction_features
            """)
            summary = cur.fetchone()

    return summary


@app.get("/transactions/{transaction_id}/investigate")
def investigate_transaction(transaction_id: str):
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Fetch Transaction Details
            cur.execute(
                """
                SELECT *, 
                       CAST(rule_foreign_transaction AS INT) as rule_foreign_transaction_int,
                       CAST(rule_late_night AS INT) as rule_late_night_int
                FROM transaction_features WHERE transaction_id = %s
                """,
                (transaction_id,),
            )
            tx = cur.fetchone()

            if not tx:
                raise HTTPException(status_code=404, detail="Transaction not found")

            # 2. Add ML Score & Explainability Features
            if ml_model:
                ml_score = compute_ml_scores([tx])[0]
                tx["ml_risk_score"] = ml_score
                tx["hybrid_risk_score"] = int((tx["sql_risk_score"] * 0.6) + (ml_score * 0.4))
                tx["ml_explanations"] = explain_ml_anomaly(tx)
            else:
                tx["ml_risk_score"] = 0
                tx["hybrid_risk_score"] = tx["sql_risk_score"]
                tx["ml_explanations"] = []

            # 3. Fetch past 10 transactions for this account
            cur.execute(
                """
                SELECT transaction_id, timestamp, amount, merchant_id, status 
                FROM transactions 
                WHERE account_id = %s 
                ORDER BY timestamp DESC LIMIT 10
                """,
                (tx["account_id"],),
            )
            history = cur.fetchall()
            tx["account_history"] = history

            # 4. Fetch analyst case audit log for this transaction
            cur.execute(
                """
                SELECT action_id, action, analyst_notes, resolved_by, created_at
                FROM fraud_actions
                WHERE transaction_id = %s
                ORDER BY created_at DESC
                """,
                (transaction_id,),
            )
            actions = cur.fetchall()
            tx["audit_history"] = actions

    return tx


@app.post("/transactions/{transaction_id}/action")
async def take_case_action(transaction_id: str, payload: CaseActionRequest):
    """Analyst case management endpoint to resolve alerts, block cards, or flag false positives."""
    valid_actions = {"BLOCK_CARD", "FALSE_POSITIVE", "REQUEST_KYC", "RESOLVED"}
    if payload.action not in valid_actions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action '{payload.action}'. Allowed: {', '.join(valid_actions)}"
        )

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify transaction exists and fetch associated card
            cur.execute(
                "SELECT transaction_id, card_id, account_id, status FROM transactions WHERE transaction_id = %s",
                (transaction_id,),
            )
            tx = cur.fetchone()
            if not tx:
                raise HTTPException(status_code=404, detail="Transaction not found")

            action_id = str(uuid.uuid4())

            # If analyst blocked the card, update card status in cards table and transaction status
            if payload.action == "BLOCK_CARD" and tx.get("card_id"):
                cur.execute(
                    "UPDATE cards SET status = 'BLOCKED' WHERE card_id = %s",
                    (tx["card_id"],),
                )
                cur.execute(
                    "UPDATE transactions SET status = 'BLOCKED' WHERE transaction_id = %s",
                    (transaction_id,),
                )
            elif payload.action == "FALSE_POSITIVE":
                cur.execute(
                    "UPDATE transactions SET status = 'CLEARED' WHERE transaction_id = %s",
                    (transaction_id,),
                )

            # Insert into fraud_actions audit table
            cur.execute(
                """
                INSERT INTO fraud_actions (action_id, transaction_id, action, analyst_notes, resolved_by, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    action_id,
                    transaction_id,
                    payload.action,
                    payload.analyst_notes,
                    payload.resolved_by,
                    datetime.now(),
                ),
            )
            conn.commit()

    # Broadcast event to active dashboard clients
    await ws_manager.broadcast({
        "type": "CASE_ACTION_TAKEN",
        "data": {
            "transaction_id": transaction_id,
            "action": payload.action,
            "resolved_by": payload.resolved_by,
        }
    })

    return {
        "status": "success",
        "action_id": action_id,
        "transaction_id": transaction_id,
        "action": payload.action,
        "message": f"Action '{payload.action}' successfully recorded in audit log."
    }
