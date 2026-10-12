import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  Volume2, 
  VolumeX, 
  Radio 
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';

import MetricCard, { formatCurrency } from './components/MetricCard';
import TransactionItem from './components/TransactionItem';
import InvestigationDrawer from './components/InvestigationDrawer';
import ThreatToast from './components/ThreatToast';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

// Web Audio API zero-dependency audio synthesizer for high-threat alerts
const playAlertSound = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.32);
  } catch (e) {
    console.debug('Audio playback blocked or unavailable', e);
  }
};

export default function App() {
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeThreatToast, setActiveThreatToast] = useState(null);
  const [actionNotes, setActionNotes] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  useEffect(() => {
    fetchInitialData();

    let ws;
    let reconnectTimer;

    const connectWebSocket = () => {
      try {
        ws = new WebSocket(`${WS_BASE_URL}/ws/live`);

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'NEW_TRANSACTION' && message.data) {
              const newTx = message.data;
              const risk = newTx.hybrid_risk_score ?? newTx.sql_risk_score ?? 0;

              setRecentTransactions((prev) => [newTx, ...prev.slice(0, 19)]);

              if (risk >= 60) {
                setTransactions((prev) => [newTx, ...prev.slice(0, 49)]);
              }

              if (risk >= 80) {
                if (soundEnabledRef.current) {
                  playAlertSound();
                }
                setActiveThreatToast({
                  id: newTx.transaction_id,
                  amount: newTx.amount,
                  risk: risk,
                  time: new Date().toLocaleTimeString(),
                });
                setTimeout(() => {
                  setActiveThreatToast((cur) =>
                    cur?.id === newTx.transaction_id ? null : cur
                  );
                }, 6000);
              }

              setSummary((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  total_transactions: (prev.total_transactions || 0) + 1,
                  high_risk_transactions:
                    risk >= 60
                      ? (prev.high_risk_transactions || 0) + 1
                      : prev.high_risk_transactions,
                  velocity_flags: newTx.rule_high_velocity
                    ? (prev.velocity_flags || 0) + 1
                    : prev.velocity_flags,
                  travel_flags: newTx.rule_impossible_travel
                    ? (prev.travel_flags || 0) + 1
                    : prev.travel_flags,
                  foreign_flags: newTx.rule_foreign_transaction
                    ? (prev.foreign_flags || 0) + 1
                    : prev.foreign_flags,
                  late_night_flags: newTx.rule_late_night
                    ? (prev.late_night_flags || 0) + 1
                    : prev.late_night_flags,
                  micro_flags: newTx.rule_micro_testing
                    ? (prev.micro_flags || 0) + 1
                    : prev.micro_flags,
                  hopping_flags: newTx.rule_rapid_category_hopping
                    ? (prev.hopping_flags || 0) + 1
                    : prev.hopping_flags,
                };
              });
            }
          } catch (err) {
            console.error('WebSocket payload processing error:', err);
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        console.error('WebSocket connection error:', err);
        reconnectTimer = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();
    const interval = setInterval(fetchInitialData, 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [summaryRes, txRes, recentRes] = await Promise.all([
        fetch(`${API_BASE_URL}/analytics/summary`),
        fetch(`${API_BASE_URL}/transactions?limit=50&sort_by_risk=true`),
        fetch(`${API_BASE_URL}/transactions?limit=20&sort_by_risk=false`),
      ]);
      const summaryData = await summaryRes.json();
      const txData = await txRes.json();
      const recentData = await recentRes.json();

      setSummary(summaryData);
      setTransactions(txData);
      setRecentTransactions(recentData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching initial data:', error);
      setLoading(false);
    }
  };

  const handleTxClick = async (txId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/transactions/${txId}/investigate`);
      const data = await res.json();
      setSelectedTx(data);
      setActionNotes('');
    } catch (error) {
      console.error('Error fetching tx investigation details:', error);
    }
  };

  const handleTakeAction = async (actionType) => {
    if (!selectedTx || submittingAction) return;
    setSubmittingAction(true);
    try {
      const res = await fetch(`${API_BASE_URL}/transactions/${selectedTx.transaction_id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          analyst_notes: actionNotes,
          resolved_by: 'analyst_1',
        }),
      });
      if (res.ok) {
        const updatedRes = await fetch(`${API_BASE_URL}/transactions/${selectedTx.transaction_id}/investigate`);
        const updatedData = await updatedRes.json();
        setSelectedTx(updatedData);
        setActionNotes('');

        setTransactions((prev) =>
          prev.map((t) =>
            t.transaction_id === selectedTx.transaction_id
              ? { ...t, status: actionType === 'BLOCK_CARD' ? 'BLOCKED' : 'CLEARED' }
              : t
          )
        );
      }
    } catch (err) {
      console.error('Failed to submit case action:', err);
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return <div className="loading">Initializing Fraud Detection Engine...</div>;
  }

  const chartData = [...recentTransactions].reverse().map((tx) => ({
    time: new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    risk: tx.hybrid_risk_score ?? tx.sql_risk_score ?? 0,
    amount: tx.amount,
  }));

  return (
    <div className="dashboard-container">
      <header className="header">
        <h1><ShieldAlert size={28} /> <span>Fraud</span>Engine</h1>
        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
          <div className={`live-badge ${wsConnected ? 'connected' : 'disconnected'}`}>
            <span className="pulse-dot" />
            {wsConnected ? 'Live Stream Online' : 'Connecting Stream...'}
          </div>

          <button 
            className={`btn-icon-toggle ${soundEnabled ? 'active' : ''}`}
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? 'Mute alert sounds' : 'Enable alert sounds'}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'Sound ON' : 'Muted'}</span>
          </button>
        </div>
      </header>

      {summary && (
        <div className="summary-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'}}>
          <MetricCard title="Total Analyzed" value={summary.total_transactions} />
          <MetricCard title="High Risk Alerts" value={summary.high_risk_transactions} type="danger" />
          <MetricCard title="Velocity Attacks" value={summary.velocity_flags} type="warning" />
          <MetricCard title="Impossible Travel" value={summary.travel_flags} type="warning" />
          <MetricCard title="Foreign TX" value={summary.foreign_flags} type="warning" />
          <MetricCard title="Late Night" value={summary.late_night_flags} type="warning" />
          <MetricCard title="Micro Testing" value={summary.micro_flags} type="warning" />
          <MetricCard title="Category Hopping" value={summary.hopping_flags} type="warning" />
        </div>
      )}

      <div className="main-content">
        <div className="panel">
          <h2 className="panel-header">Recent High-Risk Activity</h2>
          <div className="transaction-list">
            {transactions.map((tx) => (
              <TransactionItem 
                key={tx.transaction_id} 
                tx={tx} 
                onSelect={handleTxClick} 
              />
            ))}
          </div>
        </div>

        <div>
          <div className="panel" style={{marginBottom: '2rem'}}>
            <h2 className="panel-header">Risk Timeline (Recent 20)</h2>
            <div style={{height: '250px'}}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--danger-color)" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="var(--danger-color)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="time" stroke="var(--text-secondary)" fontSize={12} />
                  <YAxis stroke="var(--text-secondary)" fontSize={12} domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px'}}
                    itemStyle={{color: 'var(--text-primary)'}}
                  />
                  <Area type="monotone" dataKey="risk" stroke="var(--danger-color)" fillOpacity={1} fill="url(#colorRisk)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          
          <div className="panel">
            <h2 className="panel-header">Engine Subsystems</h2>
            <div className="rule-list">
              <div className="rule-item">
                <ShieldCheck size={18} className="rule-icon inactive" />
                <span>Deterministic Rules Engine Active</span>
              </div>
              <div className="rule-item">
                <ShieldCheck size={18} className="rule-icon inactive" />
                <span>Calibrated Isolation Forest Online</span>
              </div>
              <div className="rule-item">
                <ShieldCheck size={18} className="rule-icon inactive" />
                <span>SHAP Feature Attribution Active</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modular Investigation Modal */}
      <InvestigationDrawer 
        selectedTx={selectedTx}
        onClose={() => setSelectedTx(null)}
        actionNotes={actionNotes}
        setActionNotes={setActionNotes}
        onTakeAction={handleTakeAction}
        submittingAction={submittingAction}
      />

      {/* Modular Real-time Threat Alert Toast */}
      <ThreatToast 
        toast={activeThreatToast}
        onInvestigate={handleTxClick}
        onDismiss={() => setActiveThreatToast(null)}
      />
    </div>
  );
}
