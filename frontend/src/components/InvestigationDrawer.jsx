import React from 'react';
import { 
  AlertCircle, 
  X, 
  ShieldAlert, 
  ShieldCheck, 
  XOctagon, 
  AlertTriangle, 
  TrendingUp,
  Cpu
} from 'lucide-react';
import { formatCurrency, formatDate } from './MetricCard';

export default function InvestigationDrawer({
  selectedTx,
  onClose,
  actionNotes,
  setActionNotes,
  onTakeAction,
  submittingAction
}) {
  if (!selectedTx) return null;

  return (
    <div className="modal-overlay" onClick={(e) => {
      if (e.target.className === 'modal-overlay') onClose();
    }}>
      <div className="modal-content">
        <div className="modal-header">
          <h2 style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            <AlertCircle color="var(--danger-color)" /> 
            Transaction Investigation
          </h2>
          <button className="btn-close" onClick={onClose}><X size={24} /></button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            
            <div className="detail-section">
              <h4>Transaction Details</h4>
              <div className="detail-row">
                <span className="detail-label">ID</span>
                <span className="detail-value" style={{fontFamily:'monospace'}}>{selectedTx.transaction_id}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Account</span>
                <span className="detail-value" style={{fontFamily:'monospace'}}>{selectedTx.account_id}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Amount</span>
                <span className="detail-value" style={{fontWeight: 700, fontSize: '1.2rem'}}>{formatCurrency(selectedTx.amount)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Time</span>
                <span className="detail-value">{formatDate(selectedTx.timestamp)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Distance from Prev</span>
                <span className="detail-value">{Number(selectedTx.distance_km || 0).toFixed(2)} km</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Travel Speed</span>
                <span className="detail-value">{Number(selectedTx.travel_speed_kmh || 0).toFixed(2)} km/h</span>
              </div>
            </div>

            <div className="detail-section">
              <h4>Risk Evaluation</h4>
              
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '1rem'}}>
                <div style={{textAlign: 'center'}}>
                  <div className="score-value" style={{color: 'var(--accent-color)'}}>{selectedTx.sql_risk_score}</div>
                  <div className="score-label">SQL Score</div>
                </div>
                <div style={{textAlign: 'center'}}>
                  <div className="score-value" style={{color: '#9f7aea'}}>{selectedTx.ml_risk_score}</div>
                  <div className="score-label">ML Score</div>
                </div>
                <div style={{textAlign: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: '0 1rem', borderRadius: '8px'}}>
                  <div className="score-value critical">{selectedTx.hybrid_risk_score}</div>
                  <div className="score-label">Hybrid Risk</div>
                </div>
              </div>

              {/* Phase 4: ML Tree Explanations / Feature Importance */}
              {selectedTx.ml_explanations && selectedTx.ml_explanations.length > 0 && (
                <div style={{marginBottom: '1.25rem', padding: '0.85rem', background: 'rgba(159, 122, 234, 0.1)', border: '1px solid rgba(159, 122, 234, 0.3)', borderRadius: '8px'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color: '#d6bcfa', marginBottom: '0.5rem'}}>
                    <Cpu size={14} /> ML Isolation Forest Feature Attribution
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '0.4rem'}}>
                    {selectedTx.ml_explanations.map((exp, idx) => (
                      <div key={idx} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem'}}>
                        <span style={{color: 'var(--text-primary)'}}>{exp.feature}</span>
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                          <div style={{width: '60px', height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden'}}>
                            <div style={{width: `${exp.impact_pct}%`, height: '100%', background: '#9f7aea'}} />
                          </div>
                          <span style={{color: '#b794f4', fontWeight: 600, minWidth: '32px', textAlign: 'right'}}>{exp.impact_pct}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rule-list">
                <div className="rule-item">
                  {selectedTx.rule_high_velocity ? <XOctagon size={18} className="rule-icon active"/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>High Velocity Attack (&gt;{selectedTx.velocity_count} tx/2min)</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_amount_anomaly ? <XOctagon size={18} className="rule-icon active"/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Value Anomaly (Z-Score: {Number(selectedTx.z_score || 0).toFixed(2)})</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_impossible_travel ? <XOctagon size={18} className="rule-icon active"/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Impossible Travel (&gt;1000 km/h)</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_new_device ? <AlertTriangle size={18} className="rule-icon active" style={{color: 'var(--warning-color)'}}/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Unrecognized Device</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_foreign_transaction ? <AlertTriangle size={18} className="rule-icon active" style={{color: 'var(--warning-color)'}}/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Foreign Transaction (Cross-border)</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_late_night ? <AlertTriangle size={18} className="rule-icon active" style={{color: 'var(--warning-color)'}}/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Late Night Transaction (1AM - 5AM)</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_micro_testing ? <XOctagon size={18} className="rule-icon active"/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Micro-Charge Testing (Small frequent charges)</span>
                </div>
                <div className="rule-item">
                  {selectedTx.rule_rapid_category_hopping ? <AlertTriangle size={18} className="rule-icon active" style={{color: 'var(--warning-color)'}}/> : <ShieldCheck size={18} className="rule-icon inactive"/>}
                  <span>Rapid Category Hopping</span>
                </div>
              </div>
            </div>

          </div>
          
          <div className="detail-section" style={{marginTop: '2rem'}}>
            <h4>Account History (Last 5)</h4>
            <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
              {selectedTx.account_history?.slice(0, 5).map(h => (
                <div key={h.transaction_id} style={{display: 'flex', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'var(--bg-color)', borderRadius: '8px'}}>
                  <span style={{fontFamily: 'monospace', color: 'var(--text-secondary)'}}>{h.transaction_id.substring(0,8)}</span>
                  <span>{formatDate(h.timestamp)}</span>
                  <span style={{fontWeight: 600}}>{formatCurrency(h.amount)}</span>
                  <span style={{color: h.status === 'SUCCESS' ? 'var(--success-color)' : 'var(--danger-color)'}}>{h.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Case Resolution Panel */}
          <div className="action-box">
            <div className="action-box-title">
              <ShieldAlert size={16} color="var(--accent-color)" /> Analyst Case Resolution
            </div>
            <input 
              type="text" 
              className="action-notes-input"
              placeholder="Enter analyst resolution notes (e.g., 'Customer confirmed overseas trip')..."
              value={actionNotes}
              onChange={(e) => setActionNotes(e.target.value)}
              disabled={submittingAction}
            />
            <div className="action-buttons-grid">
              <button 
                className="btn-action block"
                onClick={() => onTakeAction('BLOCK_CARD')}
                disabled={submittingAction}
              >
                <XOctagon size={14} /> Block Card & Flag Fraud
              </button>
              <button 
                className="btn-action clear"
                onClick={() => onTakeAction('FALSE_POSITIVE')}
                disabled={submittingAction}
              >
                <ShieldCheck size={14} /> Clear / False Positive
              </button>
              <button 
                className="btn-action kyc"
                onClick={() => onTakeAction('REQUEST_KYC')}
                disabled={submittingAction}
              >
                <AlertTriangle size={14} /> Request KYC Verification
              </button>
            </div>

            {/* Audit Trail List */}
            {selectedTx.audit_history && selectedTx.audit_history.length > 0 && (
              <div>
                <div style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginTop: '1rem', marginBottom: '0.4rem'}}>
                  Audit Trail ({selectedTx.audit_history.length})
                </div>
                <div className="audit-timeline">
                  {selectedTx.audit_history.map((entry) => (
                    <div key={entry.action_id} className="audit-entry">
                      <div className="audit-entry-top">
                        <span className={`audit-action-tag ${entry.action}`}>
                          {entry.action.replace('_', ' ')}
                        </span>
                        <span style={{color: 'var(--text-secondary)', fontSize: '0.7rem'}}>
                          {formatDate(entry.created_at)} by {entry.resolved_by}
                        </span>
                      </div>
                      {entry.analyst_notes && (
                        <div style={{color: 'var(--text-primary)', marginTop: '0.2rem', fontStyle: 'italic'}}>
                          "{entry.analyst_notes}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
