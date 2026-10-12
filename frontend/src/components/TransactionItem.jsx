import React from 'react';
import { formatCurrency, formatDate, getRiskLevel } from './MetricCard';

export default function TransactionItem({ tx, onSelect }) {
  const risk = tx.hybrid_risk_score ?? tx.sql_risk_score ?? 0;
  const level = getRiskLevel(risk);

  return (
    <div 
      className={`transaction-item risk-${level}`}
      onClick={() => onSelect(tx.transaction_id)}
    >
      <div className="tx-info">
        <span className="tx-id">{tx.transaction_id.substring(0, 8)}...</span>
        <span className="tx-amount">{formatCurrency(tx.amount)}</span>
        <div className="tx-badges">
          {tx.rule_high_velocity && <span className="badge danger">Velocity</span>}
          {tx.rule_amount_anomaly && <span className="badge danger">Value Anomaly</span>}
          {tx.rule_impossible_travel && <span className="badge danger">Travel</span>}
          {tx.rule_new_device && <span className="badge danger">New Device</span>}
          {tx.rule_foreign_transaction && <span className="badge warning">Foreign</span>}
          {tx.rule_late_night && <span className="badge warning">Late Night</span>}
          {tx.rule_micro_testing && <span className="badge danger">Micro Test</span>}
          {tx.rule_rapid_category_hopping && <span className="badge warning">Cat Hop</span>}
          {tx.status === 'BLOCKED' && <span className="badge danger" style={{background: '#9b2c2c'}}>CARD BLOCKED</span>}
          {tx.status === 'CLEARED' && <span className="badge warning" style={{background: '#276749'}}>CLEARED</span>}
        </div>
      </div>
      <div className="tx-score">
        <span className={`score-value ${level}`}>{risk}</span>
        <span className="score-label">Risk Score</span>
        <span style={{fontSize: '0.7rem', color: 'var(--text-secondary)'}}>{formatDate(tx.timestamp)}</span>
      </div>
    </div>
  );
}
