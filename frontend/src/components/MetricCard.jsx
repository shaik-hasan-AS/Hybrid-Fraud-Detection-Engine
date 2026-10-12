import React from 'react';

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const formatDate = (dateString) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(dateString));
};

export const getRiskLevel = (score) => {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
};

export default function MetricCard({ title, value, type = 'normal' }) {
  return (
    <div className="summary-card">
      <h3>{title}</h3>
      <div className={`value ${type}`}>{typeof value === 'number' ? value.toLocaleString() : value || 0}</div>
    </div>
  );
}
