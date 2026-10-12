CREATE TABLE customers (
    customer_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    country VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE accounts (
    account_id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) REFERENCES customers(customer_id),
    account_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20)
);

CREATE TABLE cards (
    card_id VARCHAR(50) PRIMARY KEY,
    account_id VARCHAR(50) REFERENCES accounts(account_id),
    card_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20)
);

CREATE TABLE merchants (
    merchant_id VARCHAR(50) PRIMARY KEY,
    merchant_name VARCHAR(100),
    category VARCHAR(50),
    latitude FLOAT,
    longitude FLOAT,
    country VARCHAR(50)
);

CREATE TABLE devices (
    device_id VARCHAR(50) PRIMARY KEY,
    device_type VARCHAR(50),
    operating_system VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transactions (
    transaction_id VARCHAR(50) PRIMARY KEY,
    account_id VARCHAR(50) REFERENCES accounts(account_id),
    card_id VARCHAR(50) REFERENCES cards(card_id),
    merchant_id VARCHAR(50) REFERENCES merchants(merchant_id),
    device_id VARCHAR(50) REFERENCES devices(device_id),
    timestamp TIMESTAMP,
    amount FLOAT,
    currency VARCHAR(10),
    latitude FLOAT,
    longitude FLOAT,
    country VARCHAR(50),
    ip_address VARCHAR(50),
    payment_method VARCHAR(50),
    status VARCHAR(20)
);

-- Indexes for performance
CREATE INDEX idx_transactions_account_id ON transactions(account_id, timestamp);
CREATE INDEX idx_transactions_account_device_ts ON transactions(account_id, device_id, timestamp);
CREATE INDEX idx_transactions_card_id ON transactions(card_id, timestamp);
CREATE INDEX idx_transactions_merchant_id ON transactions(merchant_id);
CREATE INDEX idx_transactions_device_id ON transactions(device_id);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);

-- Analyst Case Management & Resolution Audit Log
CREATE TABLE fraud_actions (
    action_id VARCHAR(50) PRIMARY KEY,
    transaction_id VARCHAR(50) REFERENCES transactions(transaction_id),
    action VARCHAR(50) NOT NULL,
    analyst_notes TEXT,
    resolved_by VARCHAR(50) DEFAULT 'analyst_1',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fraud_actions_tx ON fraud_actions(transaction_id);
CREATE INDEX idx_fraud_actions_created ON fraud_actions(created_at);
