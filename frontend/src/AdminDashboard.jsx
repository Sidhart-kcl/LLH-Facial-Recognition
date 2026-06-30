import { useState, useEffect } from 'react';

const API = 'http://localhost:5050';

const IconRefresh = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2}>
    <path d="M1 4v6h6M23 20v-6h-6" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15A9 9 0 0 0 18.36 18.36" />
  </svg>
);

export function AdminDashboard({ onBack }) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    registered: 0,
    tokenIssued: 0,
  });

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/patients`);
      const data = await res.json();
      const nextPatients = data.patients || [];
      setPatients(nextPatients);

      // Calculate stats
      const registered = nextPatients.filter(p => p.registered).length;
      const tokenIssued = nextPatients.filter(p => p.token_issued).length;
      setStats({
        total: nextPatients.length,
        registered,
        tokenIssued,
      });
    } catch (err) {
      console.error('Failed to fetch patients:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  return (
    <div style={styles.container}>
      <style>{dashboardStyles}</style>

      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <button onClick={onBack} style={styles.backBtn}>← Back</button>
          <h1>MediPass Admin Dashboard</h1>
        </div>
        <div style={styles.headerActions}>
          <button onClick={fetchPatients} disabled={loading} style={styles.refreshBtn}>
            <IconRefresh /> {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Patients</div>
          <div style={styles.statValue}>{stats.total}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Registered</div>
          <div style={styles.statValue}>{stats.registered}</div>
          <div style={styles.statPercent}>
            {stats.total > 0 ? Math.round((stats.registered / stats.total) * 100) : 0}%
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Tokens Issued</div>
          <div style={styles.statValue}>{stats.tokenIssued}</div>
          <div style={styles.statPercent}>
            {stats.total > 0 ? Math.round((stats.tokenIssued / stats.total) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* Patients Table */}
      <div style={styles.tableContainer}>
        <h2>Patients</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Patient ID</th>
              <th>Name</th>
              <th>Appointment</th>
              <th>Doctor</th>
              <th>Registered</th>
              <th>Token Issued</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((p) => (
              <tr key={p.patient_id}>
                <td>
                  <code>{p.patient_id}</code>
                </td>
                <td>{p.name}</td>
                <td>
                  <small>{p.appointment_time ? new Date(p.appointment_time).toLocaleString() : 'Not set'}</small>
                </td>
                <td>{p.doctor || 'Not set'}</td>
                <td>{p.registered ? '✅' : '❌'}</td>
                <td>{p.token_issued ? '✅' : '⏳'}</td>
                <td>
                  <code style={styles.tokenCode}>{p.digital_token || 'Not issued'}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #1e293b',
    color: '#64748b',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  refreshBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: '#0ea5e9',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '32px',
  },
  statCard: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '20px',
  },
  statLabel: {
    fontSize: '12px',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#38bdf8',
  },
  statPercent: {
    fontSize: '12px',
    color: '#475569',
    marginTop: '8px',
  },
  tableContainer: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '20px',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tokenCode: {
    fontFamily: 'monospace',
    fontSize: '11px',
    background: 'rgba(56,189,248,0.1)',
    padding: '2px 6px',
    borderRadius: '3px',
    color: '#38bdf8',
  },
};

const dashboardStyles = `
  h1 { font-size: 28px; font-weight: 700; color: #f8fafc; margin: 0; }
  h2 { font-size: 18px; font-weight: 600; color: #cbd5e1; margin-bottom: 16px; }
  
  table { width: 100%; }
  th {
    text-align: left;
    padding: 12px 16px;
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #1e293b;
    background: rgba(15,23,42,0.5);
  }
  td {
    padding: 12px 16px;
    border-bottom: 1px solid #1e293b;
    font-size: 13px;
    color: #cbd5e1;
  }
  tr:hover { background: rgba(56,189,248,0.05); }
  code {
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: #0ea5e9;
    background: rgba(14,165,233,0.1);
    padding: 2px 6px;
    border-radius: 3px;
  }
  small { color: #64748b; font-size: 11px; }
`;
