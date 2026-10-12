import React from 'react';
import { AlertCircle, ShieldAlert, X } from 'lucide-react';
import { formatCurrency } from './MetricCard';

export default function ThreatToast({ toast, onInvestigate, onDismiss }) {
  if (!toast) return null;

  return (
    <div className="toast-container">
      <div 
        className="threat-toast"
        onClick={() => onInvestigate(toast.id)}
        style={{cursor: 'pointer'}}
      >
        <AlertCircle size={22} color="var(--danger-color)" style={{flexShrink: 0}} />
        <div style={{flex: 1}}>
          <div className="toast-header">
            <span className="toast-title">
              <ShieldAlert size={14} /> CRITICAL THREAT DETECTED
            </span>
            <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>
              {toast.time}
            </span>
          </div>
          <div className="toast-desc">
            Transaction <strong>{toast.id.substring(0, 8)}...</strong> flagged with Risk Score <strong>{toast.risk}</strong> ({formatCurrency(toast.amount)}). Click to investigate.
          </div>
        </div>
        <button 
          className="btn-close" 
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          style={{padding: '0.2rem'}}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
