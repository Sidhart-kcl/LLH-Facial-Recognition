import { useState, useRef, useCallback, useEffect } from "react";
import BookingFlow from "./BookingFlow";

const API = "http://localhost:5050";

// ── Icons ──────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconCalendar = () => <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM16 3v4M8 3v4M3 10h18" />;
const IconCamera = () => <Icon d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 13m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0" />;
const IconCheck = () => <Icon d="M20 6L9 17l-5-5" />;
const IconX = () => <Icon d="M18 6L6 18M6 6l12 12" />;
const IconToken = () => <Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;
const IconUser = () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;

export default function App() {
  const [mode, setMode] = useState("menu"); // menu | booking | checkin

  return (
    <>
      <style>{styles}</style>
      
      {mode === "menu" && <MainMenu onSelectMode={setMode} />}
      {mode === "booking" && <BookingFlow />}
      {mode === "checkin" && <CheckInFlow />}
    </>
  );
}

// ── Main Menu ──────────────────────────────────────────────────────────────
function MainMenu({ onSelectMode }) {
  return (
    <div className="menu-shell">
      <header className="menu-header">
        <div className="logo">🏥 MediPass</div>
        <p>Digital Token Appointment System</p>
      </header>

      <main className="menu-main">
        <div className="menu-card">
          <h1>Welcome</h1>
          <p>What would you like to do?</p>

          <div className="menu-options">
            <button
              className="menu-option booking"
              onClick={() => onSelectMode("booking")}
            >
              <div className="option-icon">📝</div>
              <div className="option-text">
                <h2>Book Appointment</h2>
                <p>Schedule an appointment and register your face</p>
              </div>
              <div className="option-arrow">→</div>
            </button>

            <button
              className="menu-option checkin"
              onClick={() => onSelectMode("checkin")}
            >
              <div className="option-icon">📸</div>
              <div className="option-text">
                <h2>Check In</h2>
                <p>Scan your face to retrieve your digital token</p>
              </div>
              <div className="option-arrow">→</div>
            </button>
          </div>

          <div className="features">
            <h3>Features</h3>
            <ul>
              <li>✅ No paper tokens</li>
              <li>✅ Instant face recognition</li>
              <li>✅ Secure on-premise storage</li>
              <li>✅ One scan = instant token</li>
            </ul>
          </div>
        </div>
      </main>

      <footer className="menu-footer">
        Your data stays on premise • HIPAA compliant
      </footer>
    </div>
  );
}

// ── Check-In Flow ──────────────────────────────────────────────────────────
function CheckInFlow() {
  const [phase, setPhase] = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleCapture = async (b64) => {
    setLoading(true);
    setPhase("scanning");
    try {
      const res = await fetch(`${API}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: b64 }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        setPhase("success");
      } else {
        setError(data.error || "Verification failed.");
        setPhase("error");
      }
    } catch {
      setError("Cannot reach the server. Is backend running on port 5050?");
      setPhase("error");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setError(null);
  };

  return (
    <>
      {phase === "success" && result ? (
        <TokenCard result={result} onReset={reset} onBack={() => window.location.reload()} />
      ) : (
        <CameraCheckIn onCapture={handleCapture} loading={loading} error={error} phase={phase} onReset={reset} onBack={() => window.location.reload()} />
      )}
    </>
  );
}

// ── Camera Component ───────────────────────────────────────────────────────
function CameraCheckIn({ onCapture, loading, error, phase, onReset, onBack }) {
  const [streaming, setStreaming] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setStreaming(true);
        }
      } catch (e) {
        setCamErr("Camera access denied.");
      }
    })();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  const capture = () => {
    if (!streaming) return;
    let c = 3;
    setCountdown(c);
    const iv = setInterval(() => {
      c -= 1;
      if (c > 0) { setCountdown(c); return; }
      clearInterval(iv);
      setCountdown(null);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const b64 = canvas.toDataURL("image/jpeg", 0.92);
      onCapture(b64);
    }, 1000);
  };

  return (
    <div className="checkin-shell">
      <header className="checkin-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>Face Verification</h1>
      </header>

      <main className="checkin-main">
        <div className="checkin-card">
          {camErr ? (
            <div className="cam-error">
              <p>{camErr}</p>
            </div>
          ) : (
            <>
              <div className="video-frame">
                <video ref={videoRef} autoPlay playsInline muted className="video-el" />
                <div className="scan-overlay">
                  <div className="scan-corner tl" /><div className="scan-corner tr" />
                  <div className="scan-corner bl" /><div className="scan-corner br" />
                  {countdown && <div className="countdown">{countdown}</div>}
                </div>
              </div>
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <button
                className="btn-capture"
                onClick={capture}
                disabled={loading || !streaming || countdown !== null}
              >
                {loading ? (
                  <><span className="spinner" /> Verifying…</>
                ) : countdown ? (
                  `Hold still… ${countdown}`
                ) : (
                  <>📸 Capture & Verify</>
                )}
              </button>
              <p className="cam-hint">Position your face within the frame</p>
            </>
          )}

          {error && (
            <div className="error-bar">
              <span>{error}</span>
              <button className="btn-retry" onClick={onReset}>Retry</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Token Display Card ─────────────────────────────────────────────────────
function TokenCard({ result, onReset, onBack }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(result.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="token-shell">
      <header className="token-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>✅ Token Retrieved</h1>
      </header>

      <main className="token-main">
        <div className="token-card">
          <div className="token-badge" onClick={copy} title="Click to copy">
            <span className="token-value">{result.token}</span>
            <span className="copy-hint">{copied ? "Copied!" : "Click to copy"}</span>
          </div>

          <div className="patient-info">
            <div className="info-section">
              <h3>Patient Information</h3>
              <div className="info-item">
                <span className="label">Name:</span>
                <span className="value">{result.patient.name}</span>
              </div>
              <div className="info-item">
                <span className="label">Patient ID:</span>
                <span className="value code">{result.patient.patient_id}</span>
              </div>
            </div>

            <div className="info-section">
              <h3>Appointment</h3>
              <div className="info-item">
                <span className="label">Time:</span>
                <span className="value">{result.patient.appointment_time}</span>
              </div>
              <div className="info-item">
                <span className="label">Doctor:</span>
                <span className="value">{result.patient.doctor}</span>
              </div>
              <div className="info-item">
                <span className="label">Department:</span>
                <span className="value">{result.patient.department}</span>
              </div>
            </div>

            <div className="confidence">
              <span>Recognition Confidence:</span>
              <span className="confidence-value">{result.confidence}%</span>
            </div>
          </div>

          <button className="btn-reset" onClick={onReset}>Scan Another Face</button>
        </div>
      </main>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    background: #030712;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  /* Menu Styles */
  .menu-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #0f1f3d 0%, #030712 70%);
  }

  .menu-header {
    padding: 24px;
    text-align: center;
    border-bottom: 1px solid #1e293b;
  }

  .logo {
    font-size: 28px;
    font-weight: 700;
    color: #38bdf8;
    margin-bottom: 4px;
  }

  .menu-header p {
    font-size: 13px;
    color: #64748b;
  }

  .menu-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
  }

  .menu-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 20px;
    padding: 32px;
    width: 100%;
    max-width: 600px;
    box-shadow: 0 0 60px rgba(56, 189, 248, 0.05);
  }

  .menu-card h1 {
    font-size: 24px;
    font-weight: 700;
    color: #f8fafc;
    margin-bottom: 8px;
  }

  .menu-card > p {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 32px;
  }

  .menu-options {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 32px;
  }

  .menu-option {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 20px;
    background: #1a2332;
    border: 1px solid #1e293b;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .menu-option:hover {
    background: #0f1a2a;
    border-color: #38bdf8;
    transform: translateX(4px);
  }

  .menu-option.booking {
    border-color: rgba(14, 165, 233, 0.3);
  }

  .menu-option.checkin {
    border-color: rgba(34, 197, 94, 0.3);
  }

  .option-icon {
    font-size: 32px;
    flex-shrink: 0;
  }

  .option-text {
    flex: 1;
    text-align: left;
  }

  .option-text h2 {
    font-size: 16px;
    font-weight: 600;
    color: #f8fafc;
    margin-bottom: 4px;
  }

  .option-text p {
    font-size: 12px;
    color: #64748b;
  }

  .option-arrow {
    font-size: 24px;
    color: #38bdf8;
    flex-shrink: 0;
  }

  .features {
    background: rgba(56, 189, 248, 0.05);
    border: 1px solid rgba(56, 189, 248, 0.1);
    border-radius: 12px;
    padding: 16px;
  }

  .features h3 {
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .features ul {
    list-style: none;
  }

  .features li {
    font-size: 12px;
    color: #64748b;
    padding: 4px 0;
  }

  .menu-footer {
    text-align: center;
    padding: 16px;
    font-size: 11px;
    color: #1e293b;
  }

  /* Check-in Styles */
  .checkin-shell, .token-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #0f1f3d 0%, #030712 70%);
  }

  .checkin-header, .token-header {
    padding: 16px;
    border-bottom: 1px solid #1e293b;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .back-btn {
    background: transparent;
    border: 1px solid #1e293b;
    color: #64748b;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  }

  .back-btn:hover {
    border-color: #38bdf8;
    color: #38bdf8;
  }

  .checkin-header h1, .token-header h1 {
    font-size: 18px;
    color: #f8fafc;
    flex: 1;
  }

  .checkin-main, .token-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
  }

  .checkin-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 20px;
    padding: 20px;
    width: 100%;
    max-width: 520px;
  }

  .video-frame {
    position: relative;
    border-radius: 14px;
    overflow: hidden;
    aspect-ratio: 4/3;
    background: #020617;
    border: 1px solid #1e293b;
    margin-bottom: 16px;
  }

  .video-el {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .scan-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .scan-corner {
    position: absolute;
    width: 28px;
    height: 28px;
    border-color: #38bdf8;
    border-style: solid;
    opacity: 0.8;
  }

  .scan-corner.tl { top: 16px; left: 16px; border-width: 2px 0 0 2px; }
  .scan-corner.tr { top: 16px; right: 16px; border-width: 2px 2px 0 0; }
  .scan-corner.bl { bottom: 16px; left: 16px; border-width: 0 0 2px 2px; }
  .scan-corner.br { bottom: 16px; right: 16px; border-width: 0 2px 2px 0; }

  .countdown {
    font-size: 72px;
    font-weight: 800;
    color: #38bdf8;
    text-shadow: 0 0 40px #38bdf8;
  }

  .btn-capture {
    width: 100%;
    padding: 14px;
    background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s;
  }

  .btn-capture:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .btn-capture:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .cam-hint {
    font-size: 12px;
    color: #475569;
    text-align: center;
    margin-top: 12px;
  }

  .cam-error {
    padding: 20px;
    text-align: center;
    color: #ef4444;
    font-size: 13px;
  }

  .error-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 10px;
    padding: 12px 14px;
    color: #fca5a5;
    font-size: 13px;
    margin-top: 8px;
  }

  .btn-retry {
    margin-left: auto;
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: #fca5a5;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }

  /* Token Card */
  .token-card {
    background: #0f172a;
    border: 1px solid #1e3a5f;
    border-radius: 20px;
    padding: 32px;
    width: 100%;
    max-width: 520px;
  }

  .token-badge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(99, 102, 241, 0.1));
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 24px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .token-badge:hover {
    border-color: rgba(56, 189, 248, 0.5);
  }

  .token-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 22px;
    font-weight: 700;
    color: #38bdf8;
    letter-spacing: 2px;
  }

  .copy-hint {
    font-size: 11px;
    color: #64748b;
  }

  .patient-info {
    margin: 24px 0;
    padding: 20px;
    background: #1a2332;
    border-radius: 12px;
  }

  .info-section {
    margin-bottom: 16px;
  }

  .info-section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 13px;
  }

  .info-item .label {
    color: #64748b;
  }

  .info-item .value {
    color: #cbd5e1;
  }

  .info-item .value.code {
    font-family: monospace;
    background: rgba(56, 189, 248, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    color: #38bdf8;
  }

  .confidence {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 8px;
    font-size: 12px;
    margin-top: 12px;
  }

  .confidence-value {
    color: #22c55e;
    font-weight: 700;
    font-size: 14px;
  }

  .btn-reset {
    width: 100%;
    padding: 11px;
    background: transparent;
    border: 1px solid #1e293b;
    color: #64748b;
    border-radius: 10px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }

  .btn-reset:hover {
    border-color: #38bdf8;
    color: #38bdf8;
  }

  @media (max-width: 540px) {
    .menu-card, .checkin-card, .token-card { padding: 20px; }
  }
`;
