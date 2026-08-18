import { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5050';
const MATCH_FAILURE_REASONS = new Set(['below_threshold', 'no_registered_embeddings']);
const DEFAULT_MATCH_THRESHOLD_PERCENT = 45;
const MATCH_THRESHOLD_MARGIN_PERCENT = 5;
const REQUIRED_FACE_SAMPLE_COUNT = 3;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const SHORT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const IconRefresh = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2}>
    <path d="M1 4v6h6M23 20v-6h-6" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15A9 9 0 0 0 18.36 18.36" />
  </svg>
);

const requestDashboardData = async () => {
  const [patientsRes, attemptsRes] = await Promise.all([
    fetch(`${API}/patients`),
    fetch(`${API}/checkin-attempts`),
  ]);

  if (!patientsRes.ok) throw new Error('Failed to fetch patients');
  if (!attemptsRes.ok) throw new Error('Failed to fetch check-in attempts');

  const [patientsData, attemptsData] = await Promise.all([
    patientsRes.json(),
    attemptsRes.json(),
  ]);
  return {
    patients: patientsData.patients || [],
    attempts: attemptsData.attempts || [],
  };
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isToday = (value) => {
  const date = parseDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
};

const average = (values) => {
  const clean = values.filter(value => typeof value === 'number' && Number.isFinite(value));
  if (clean.length === 0) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
};

const formatPercent = (value) =>
  (typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : 'No data');
const formatNumber = (value) => (value === null ? 'No data' : value.toFixed(1));
const formatReason = (reason) => reason ? reason.replaceAll('_', ' ') : 'unknown';
const formatDateTime = (value) => {
  const date = parseDate(value);
  return date ? DATE_TIME_FORMATTER.format(date) : 'Not set';
};
const patientIsRegistered = patient =>
  (patient.face_embedding_count || 0) === REQUIRED_FACE_SAMPLE_COUNT;

const isUpcomingAppointment = (patient) => {
  const appointment = parseDate(patient.appointment_time);
  return appointment ? appointment.getTime() >= Date.now() : false;
};

const patientLeadDays = (patient) => {
  const created = parseDate(patient.created_at);
  const appointment = parseDate(patient.appointment_time);
  if (!created || !appointment) return null;
  return (appointment.getTime() - created.getTime()) / 86400000;
};

const sortPatientsByAppointment = patients =>
  [...patients].sort((a, b) =>
    (parseDate(a.appointment_time)?.getTime() || 0) - (parseDate(b.appointment_time)?.getTime() || 0)
  );

const sortAttemptsNewestFirst = attempts =>
  [...attempts].sort((a, b) =>
    (parseDate(b.timestamp)?.getTime() || 0) - (parseDate(a.timestamp)?.getTime() || 0)
  );

const thresholdPercent = (attempt) => {
  if (typeof attempt.threshold !== 'number' || !Number.isFinite(attempt.threshold)) {
    return DEFAULT_MATCH_THRESHOLD_PERCENT;
  }
  return attempt.threshold <= 1 ? attempt.threshold * 100 : attempt.threshold;
};

const hasNumericConfidence = attempt =>
  typeof attempt.confidence === 'number' && Number.isFinite(attempt.confidence);

const isLowConfidenceSuccess = (attempt) => {
  if (!attempt.success || !hasNumericConfidence(attempt)) return false;
  const threshold = thresholdPercent(attempt);
  return attempt.confidence >= threshold
    && attempt.confidence <= threshold + MATCH_THRESHOLD_MARGIN_PERCENT;
};

const isNearMissFailure = (attempt) => {
  if (attempt.success || !hasNumericConfidence(attempt) || !MATCH_FAILURE_REASONS.has(attempt.reason)) {
    return false;
  }
  const threshold = thresholdPercent(attempt);
  return attempt.confidence >= threshold - MATCH_THRESHOLD_MARGIN_PERCENT
    && attempt.confidence < threshold;
};

const countBy = (items, keyFn) => {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
};

const checkinsByHour = (attempts) => {
  const buckets = new Map();
  attempts.forEach((attempt) => {
    const date = parseDate(attempt.timestamp);
    if (!date) return;
    date.setMinutes(0, 0, 0);
    const key = date.toISOString();
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, value]) => ({
      label: SHORT_DATE_TIME_FORMATTER.format(new Date(key)),
      value,
    }));
};

const departmentBreakdown = (patients, attempts) => {
  const departments = new Map();

  patients.forEach((patient) => {
    const department = patient.department || 'Unknown';
    const current = departments.get(department) || { label: department, appointments: 0, checkins: 0 };
    current.appointments += 1;
    departments.set(department, current);
  });

  attempts.forEach((attempt) => {
    const department = attempt.department || 'Unknown';
    const current = departments.get(department) || { label: department, appointments: 0, checkins: 0 };
    current.checkins += 1;
    departments.set(department, current);
  });

  return Array.from(departments.values())
    .sort((a, b) => (b.appointments + b.checkins) - (a.appointments + a.checkins));
};

const repeatedFailures = (attempts) => {
  const groups = new Map();

  attempts
    .filter(attempt => !attempt.success)
    .forEach((attempt) => {
      const key = attempt.patient_id || `Unmatched: ${formatReason(attempt.reason)}`;
      const current = groups.get(key) || {
        label: key,
        count: 0,
        lastAttempt: null,
        confidences: [],
        reasons: new Map(),
      };

      current.count += 1;
      current.lastAttempt = attempt.timestamp;
      if (typeof attempt.confidence === 'number') {
        current.confidences.push(attempt.confidence);
      }
      current.reasons.set(attempt.reason, (current.reasons.get(attempt.reason) || 0) + 1);
      groups.set(key, current);
    });

  return Array.from(groups.values())
    .filter(group => group.count >= 2)
    .map(group => {
      const topReason = Array.from(group.reasons.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        ...group,
        avgConfidence: average(group.confidences),
        topReason,
      };
    })
    .sort((a, b) => b.count - a.count);
};

const buildMetrics = (patients, attempts) => {
  const upcomingAppointments = patients.filter(isUpcomingAppointment);
  const tokenIssued = patients.filter(patient => patient.token_issued).length;
  const todayAttempts = attempts.filter(attempt => isToday(attempt.timestamp));
  const todaySuccessfulAttempts = todayAttempts.filter(attempt => attempt.success);
  const successfulAttempts = attempts.filter(attempt => attempt.success);
  const failedMatchAttempts = attempts.filter(attempt =>
    !attempt.success
    && typeof attempt.confidence === 'number'
    && MATCH_FAILURE_REASONS.has(attempt.reason)
  );
  const failureReasons = countBy(attempts.filter(attempt => !attempt.success), attempt => attempt.reason);
  const mostCommonFailure = failureReasons[0]?.label || null;

  const bookedLeadDays = patients
    .map(patientLeadDays)
    .filter(value => typeof value === 'number' && Number.isFinite(value));

  const riskyAttempts = attempts
    .filter(attempt => isLowConfidenceSuccess(attempt) || isNearMissFailure(attempt))
    .sort((a, b) => (parseDate(b.timestamp)?.getTime() || 0) - (parseDate(a.timestamp)?.getTime() || 0))
    .slice(0, 12);

  return {
    totalPatients: patients.length,
    upcomingAppointments: upcomingAppointments.length,
    tokenIssued,
    todayCheckinAttempts: todayAttempts.length,
    todaySuccessfulCheckins: todaySuccessfulAttempts.length,
    successRate: attempts.length ? (successfulAttempts.length / attempts.length) * 100 : null,
    avgSuccessfulMatch: average(successfulAttempts.map(attempt => attempt.confidence)),
    avgFailedMatch: average(failedMatchAttempts.map(attempt => attempt.confidence)),
    lowConfidenceSuccesses: attempts.filter(isLowConfidenceSuccess).length,
    nearMissFailures: attempts.filter(isNearMissFailure).length,
    mostCommonFailure,
    avgDaysBookedAdvance: average(bookedLeadDays),
    failureReasons,
    checkinsOverTime: checkinsByHour(attempts),
    departmentRows: departmentBreakdown(patients, attempts),
    riskyAttempts,
    repeatedFailures: repeatedFailures(attempts),
  };
};

function DrilldownStatCard({ label, value, detail, onClick, active }) {
  return (
    <button
      type="button"
      className={`admin-stat-card${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
      style={{
        ...styles.statCard,
        ...styles.statAction,
        ...(active ? styles.statCardActive : {}),
      }}
    >
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
      {detail && <div style={styles.statPercent}>{detail}</div>}
    </button>
  );
}

function EmptyState({ message = 'No data available yet.' }) {
  return <div style={styles.emptyState}>{message}</div>;
}

function BarList({ rows, valueLabel = value => value }) {
  if (!rows.length) return <EmptyState />;
  const max = Math.max(...rows.map(row => row.value), 1);

  return (
    <div style={styles.barList}>
      {rows.map(row => (
        <div key={row.label} style={styles.barRow}>
          <div style={styles.barMeta}>
            <span>{row.label}</span>
            <strong>{valueLabel(row.value)}</strong>
          </div>
          <div style={styles.barTrack}>
            <div style={{ ...styles.barFill, width: `${Math.max((row.value / max) * 100, 4)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PatientTable({ patients, showLeadDays = false }) {
  if (!patients.length) return <EmptyState />;

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th>Patient ID</th>
          <th>Name</th>
          <th>Appointment</th>
          <th>Doctor</th>
          <th>Department</th>
          <th>Registered</th>
          <th>Token Issued</th>
          {showLeadDays && <th>Days Booked Ahead</th>}
          <th>Token</th>
        </tr>
      </thead>
      <tbody>
        {patients.map((patient) => {
          const leadDays = patientLeadDays(patient);
          return (
            <tr key={patient.patient_id}>
              <td><code>{patient.patient_id}</code></td>
              <td>{patient.name || 'Unknown'}</td>
              <td><small>{formatDateTime(patient.appointment_time)}</small></td>
              <td>{patient.doctor || 'Not set'}</td>
              <td>{patient.department || 'Not set'}</td>
              <td>{patientIsRegistered(patient) ? 'Yes' : 'No'}</td>
              <td>{patient.token_issued ? 'Yes' : 'No'}</td>
              {showLeadDays && <td>{formatNumber(leadDays)}</td>}
              <td><code style={styles.tokenCode}>{patient.digital_token || 'Not issued'}</code></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AttemptTable({ attempts }) {
  if (!attempts.length) return <EmptyState />;

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th>Time</th>
          <th>Result</th>
          <th>Confidence</th>
          <th>Threshold</th>
          <th>Patient</th>
          <th>Department</th>
          <th>Reason</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.attempt_id}>
            <td><small>{formatDateTime(attempt.timestamp)}</small></td>
            <td>{attempt.success ? 'Success' : 'Failed'}</td>
            <td>{formatPercent(attempt.confidence)}</td>
            <td>{formatPercent(thresholdPercent(attempt))}</td>
            <td><code>{attempt.patient_id || 'Unknown'}</code></td>
            <td>{attempt.department || 'Not set'}</td>
            <td>{formatReason(attempt.reason)}</td>
            <td>{attempt.error || 'None'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminDashboard({ onBack }) {
  const [patients, setPatients] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeDrilldown, setActiveDrilldown] = useState(null);

  const metrics = useMemo(() => buildMetrics(patients, attempts), [patients, attempts]);
  const drilldowns = useMemo(() => {
    const sortedPatients = sortPatientsByAppointment(patients);
    const sortedAttempts = sortAttemptsNewestFirst(attempts);
    const todayAttempts = sortedAttempts.filter(attempt => isToday(attempt.timestamp));
    const successfulAttempts = sortedAttempts.filter(attempt => attempt.success);
    const failedMatchAttempts = sortedAttempts.filter(attempt =>
      !attempt.success
      && hasNumericConfidence(attempt)
      && MATCH_FAILURE_REASONS.has(attempt.reason)
    );

    return {
      totalPatients: {
        title: 'Total Patients',
        type: 'patients',
        rows: sortedPatients,
      },
      upcomingAppointments: {
        title: 'Upcoming Appointments',
        type: 'patients',
        rows: sortedPatients.filter(isUpcomingAppointment),
      },
      tokensIssued: {
        title: 'Tokens Issued',
        type: 'patients',
        rows: sortedPatients.filter(patient => patient.token_issued),
      },
      avgDaysBookedAdvance: {
        title: 'Average Days Booked In Advance',
        type: 'patients',
        rows: sortedPatients.filter(patient => patientLeadDays(patient) !== null),
        showLeadDays: true,
      },
      todayCheckinAttempts: {
        title: "Today's Check-in Attempts",
        type: 'attempts',
        rows: todayAttempts,
      },
      todaySuccessfulCheckins: {
        title: "Today's Successful Check-ins",
        type: 'attempts',
        rows: todayAttempts.filter(attempt => attempt.success),
      },
      successRate: {
        title: 'Check-in Success Rate',
        type: 'attempts',
        rows: sortedAttempts,
      },
      mostCommonFailure: {
        title: metrics.mostCommonFailure
          ? `Most Common Failure: ${formatReason(metrics.mostCommonFailure)}`
          : 'Most Common Failure',
        type: 'attempts',
        rows: metrics.mostCommonFailure
          ? sortedAttempts.filter(attempt => !attempt.success && attempt.reason === metrics.mostCommonFailure)
          : [],
      },
      avgSuccessfulMatch: {
        title: 'Average Successful Match',
        type: 'attempts',
        rows: successfulAttempts.filter(hasNumericConfidence),
      },
      avgFailedMatch: {
        title: 'Average Failed Match',
        type: 'attempts',
        rows: failedMatchAttempts,
      },
      lowConfidenceSuccesses: {
        title: 'Low-Confidence Successes',
        type: 'attempts',
        rows: sortedAttempts.filter(isLowConfidenceSuccess),
      },
      nearMissFailures: {
        title: 'Near-Miss Failures',
        type: 'attempts',
        rows: sortedAttempts.filter(isNearMissFailure),
      },
    };
  }, [patients, attempts, metrics.mostCommonFailure]);

  const selectedDrilldown = activeDrilldown ? drilldowns[activeDrilldown] : null;

  const drilldownCard = (key, props) => (
    <DrilldownStatCard
      {...props}
      active={activeDrilldown === key}
      onClick={() => setActiveDrilldown(current => current === key ? null : key)}
    />
  );

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestDashboardData();
      setPatients(data.patients);
      setAttempts(data.attempts);
    } catch (err) {
      console.error('Failed to fetch admin dashboard data:', err);
      setError(err.message || 'Failed to fetch admin dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    requestDashboardData()
      .then((data) => {
        if (cancelled) return;
        setPatients(data.patients);
        setAttempts(data.attempts);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to fetch admin dashboard data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={styles.container}>
      <style>{dashboardStyles}</style>

      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <button className="admin-back-btn" onClick={onBack} style={styles.backBtn}>← Back</button>
          <h1>MediPass Admin Dashboard</h1>
        </div>
        <div style={styles.headerActions}>
          <button className="admin-refresh-btn" onClick={fetchDashboardData} disabled={loading} style={styles.refreshBtn}>
            <IconRefresh /> {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.statsGrid}>
        {drilldownCard('totalPatients', { label: 'Total Patients', value: metrics.totalPatients })}
        {drilldownCard('upcomingAppointments', {
          label: 'Upcoming Appointments',
          value: metrics.upcomingAppointments,
          detail: `${metrics.totalPatients ? Math.round((metrics.upcomingAppointments / metrics.totalPatients) * 100) : 0}% upcoming`,
        })}
        {drilldownCard('todayCheckinAttempts', {
          label: "Today's Check-in Attempts",
          value: metrics.todayCheckinAttempts,
        })}
        {drilldownCard('todaySuccessfulCheckins', {
          label: "Today's Successful Check-ins",
          value: metrics.todaySuccessfulCheckins,
        })}
        {drilldownCard('avgSuccessfulMatch', {
          label: 'Average Successful Match',
          value: formatPercent(metrics.avgSuccessfulMatch),
        })}
        {drilldownCard('avgFailedMatch', {
          label: 'Average Failed Match',
          value: formatPercent(metrics.avgFailedMatch),
        })}
        {drilldownCard('tokensIssued', {
          label: 'Tokens Issued',
          value: metrics.tokenIssued,
          detail: `${metrics.totalPatients ? Math.round((metrics.tokenIssued / metrics.totalPatients) * 100) : 0}% issued`,
        })}
        {drilldownCard('avgDaysBookedAdvance', {
          label: 'Avg Days Booked In Advance',
          value: formatNumber(metrics.avgDaysBookedAdvance),
        })}
        {drilldownCard('successRate', {
          label: 'Check-in Success Rate',
          value: formatPercent(metrics.successRate),
        })}
        {drilldownCard('mostCommonFailure', {
          label: 'Most Common Failure',
          value: metrics.mostCommonFailure ? formatReason(metrics.mostCommonFailure) : 'No data',
        })}
        {drilldownCard('lowConfidenceSuccesses', {
          label: 'Low-Confidence Successes',
          value: metrics.lowConfidenceSuccesses,
          detail: `within ${MATCH_THRESHOLD_MARGIN_PERCENT}% above threshold`,
        })}
        {drilldownCard('nearMissFailures', {
          label: 'Near-Miss Failures',
          value: metrics.nearMissFailures,
          detail: `within ${MATCH_THRESHOLD_MARGIN_PERCENT}% below threshold`,
        })}
      </div>

      {selectedDrilldown && (
        <section style={styles.panel}>
          <div style={styles.drilldownHeader}>
            <div>
              <h2>{selectedDrilldown.title}</h2>
              <div style={styles.drilldownMeta}>{selectedDrilldown.rows.length} records</div>
            </div>
            <button className="admin-clear-btn" type="button" onClick={() => setActiveDrilldown(null)} style={styles.closeBtn}>
              Clear
            </button>
          </div>
          {selectedDrilldown.type === 'patients' ? (
            <PatientTable
              patients={selectedDrilldown.rows}
              showLeadDays={selectedDrilldown.showLeadDays}
            />
          ) : (
            <AttemptTable attempts={selectedDrilldown.rows} />
          )}
        </section>
      )}

      <div style={styles.sectionGrid}>
        <section style={styles.panel}>
          <h2>Failure Reasons</h2>
          <BarList rows={metrics.failureReasons.map(row => ({ ...row, label: formatReason(row.label) }))} />
        </section>

        <section style={styles.panel}>
          <h2>Check-ins Over Time</h2>
          <BarList rows={metrics.checkinsOverTime} />
        </section>
      </div>

      <section style={styles.panel}>
        <h2>Department Breakdown</h2>
        {metrics.departmentRows.length ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Department</th>
                <th>Appointments</th>
                <th>Check-in Attempts</th>
              </tr>
            </thead>
            <tbody>
              {metrics.departmentRows.map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.appointments}</td>
                  <td>{row.checkins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState />}
      </section>

      <section style={styles.panel}>
        <h2>Risky Matches</h2>
        {metrics.riskyAttempts.length ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Confidence</th>
                <th>Patient</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {metrics.riskyAttempts.map(attempt => (
                <tr key={attempt.attempt_id}>
                  <td><small>{formatDateTime(attempt.timestamp)}</small></td>
                  <td>{attempt.success ? 'Low-confidence success' : 'High-confidence failure'}</td>
                  <td>{formatPercent(attempt.confidence)}</td>
                  <td><code>{attempt.patient_id || 'Unknown'}</code></td>
                  <td>{formatReason(attempt.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState message="No risky matches found." />}
      </section>

      <section style={styles.panel}>
        <h2>Repeated Failures</h2>
        {metrics.repeatedFailures.length ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Patient / Group</th>
                <th>Failures</th>
                <th>Average Confidence</th>
                <th>Most Common Reason</th>
                <th>Last Attempt</th>
              </tr>
            </thead>
            <tbody>
              {metrics.repeatedFailures.map(row => (
                <tr key={row.label}>
                  <td><code>{row.label}</code></td>
                  <td>{row.count}</td>
                  <td>{formatPercent(row.avgConfidence)}</td>
                  <td>{formatReason(row.topReason)}</td>
                  <td><small>{formatDateTime(row.lastAttempt)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState message="No repeated failures yet." />}
      </section>

      <section style={styles.panel}>
        <h2>Patients</h2>
        <PatientTable patients={sortPatientsByAppointment(patients)} />
      </section>
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1320px',
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
  errorBanner: {
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: '8px',
    color: '#fecaca',
    padding: '12px 14px',
    marginBottom: '16px',
    fontSize: '13px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '14px',
    marginBottom: '24px',
  },
  statCard: {
    background: '#0f172a',
    border: '1px solid transparent',
    borderRadius: '8px',
    padding: '16px',
    minHeight: '118px',
  },
  statAction: {
    cursor: 'pointer',
    userSelect: 'none',
    width: '100%',
    font: 'inherit',
    textAlign: 'left',
  },
  statCardActive: {
    borderColor: '#38bdf8',
    boxShadow: '0 0 0 1px rgba(56,189,248,0.25)',
  },
  statLabel: {
    minHeight: '32px',
    fontSize: '11px',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '26px',
    fontWeight: '700',
    color: '#38bdf8',
    lineHeight: 1.15,
    overflowWrap: 'anywhere',
  },
  statPercent: {
    fontSize: '12px',
    color: '#64748b',
    marginTop: '8px',
  },
  sectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px',
  },
  panel: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '8px',
    padding: '18px',
    overflowX: 'auto',
    marginBottom: '16px',
  },
  drilldownHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '16px',
  },
  drilldownMeta: {
    color: '#64748b',
    fontSize: '12px',
  },
  closeBtn: {
    background: 'transparent',
    border: '1px solid #334155',
    color: '#cbd5e1',
    padding: '7px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
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
  emptyState: {
    color: '#64748b',
    fontSize: '13px',
    padding: '16px 0',
  },
  barList: {
    display: 'grid',
    gap: '12px',
  },
  barRow: {
    display: 'grid',
    gap: '6px',
  },
  barMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '12px',
    color: '#cbd5e1',
    fontSize: '13px',
  },
  barTrack: {
    height: '8px',
    background: '#1e293b',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: '#38bdf8',
    borderRadius: '999px',
  },
};

const dashboardStyles = `
  h1 { font-size: 28px; font-weight: 700; color: #f8fafc; margin: 0; }
  h2 { font-size: 17px; font-weight: 600; color: #cbd5e1; margin: 0 0 16px; }
  button:hover { border-color: #38bdf8; }
  .admin-stat-card,
  .admin-stat-card:hover,
  .admin-stat-card:active {
    border-color: transparent !important;
    box-shadow: none !important;
    outline: none !important;
    outline-offset: 0 !important;
  }
  .admin-stat-card:focus-visible {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 3px rgba(56,189,248,0.3) !important;
    outline: none !important;
  }
  .admin-stat-card:hover:not(.is-active) {
    background: #111c33 !important;
  }
  .admin-stat-card.is-active {
    border-color: #38bdf8 !important;
    box-shadow: 0 0 0 1px rgba(56,189,248,0.25) !important;
  }
  .admin-stat-card.is-active:hover {
    background: #12213a !important;
  }
  .admin-back-btn:hover,
  .admin-clear-btn:hover {
    background: rgba(56,189,248,0.08) !important;
    border-color: #38bdf8 !important;
    color: #e0f2fe !important;
  }
  .admin-refresh-btn:hover:not(:disabled) {
    background: #38bdf8 !important;
    box-shadow: 0 0 0 1px rgba(56,189,248,0.3) !important;
  }
  .admin-refresh-btn:disabled {
    opacity: 0.65;
    cursor: wait !important;
  }

  table { width: 100%; }
  th {
    text-align: left;
    padding: 12px 14px;
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #1e293b;
    background: rgba(15,23,42,0.5);
    white-space: nowrap;
  }
  td {
    padding: 12px 14px;
    border-bottom: 1px solid #1e293b;
    font-size: 13px;
    color: #cbd5e1;
    vertical-align: top;
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

  @media (max-width: 720px) {
    h1 { font-size: 22px; }
  }
`;
