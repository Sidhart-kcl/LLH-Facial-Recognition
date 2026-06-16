import { useState, useRef, useCallback, useEffect } from "react";

const API = "http://localhost:5050";

// ── Tiny icon components ──────────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconCamera = () => <Icon d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 0 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z M12 13m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0" />;
const IconToken = () => <Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;
const IconCheck = () => <Icon d="M20 6L9 17l-5-5" />;
const IconX = () => <Icon d="M18 6L6 18M6 6l12 12" />;
const IconUser = () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;
const IconScan = () => <Icon d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />;
const IconClock = () => <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 6v6l4 2" />;

// ── Confidence ring ───────────────────────────────────────────────────────────
function ConfidenceRing({ value }) {
  const r = 28, circ = 2 * Math.PI * r;
  const stroke = value > 80 ? "#22c55e" : value > 60 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={72} height={72} viewBox="0 0 72 72">
      <circle cx={36} cy={36} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle cx={36} cy={36} r={r} fill="none" stroke={stroke} strokeWidth={6}
        strokeDasharray={circ}
        strokeDashoffset={circ - (circ * value) / 100}
        strokeLinecap="round"
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      <text x="50%" y="53%" textAnchor="middle" fill={stroke}
        fontSize="13" fontWeight="700" fontFamily="monospace">{value}%</text>
    </svg>
  );
}

// ── Digital Token card ────────────────────────────────────────────────────────
function TokenCard({ result, onReset }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(result.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="token-card">
      <div className="token-glow" />
      <div className="token-header">
        <div className="token-check"><IconCheck /></div>
        <div>
          <div className="token-title">Identity Verified</div>
          <div className="token-sub">Your digital token is ready</div>
        </div>
        <ConfidenceRing value={result.confidence} />
      </div>

      <div className="token-badge" onClick={copy} title="Click to copy">
        <IconToken />
        <span className="token-value">{result.token}</span>
        <span className="copy-hint">{copied ? "Copied!" : "Copy"}</span>
      </div>

      <div className="appt-grid">
        <div className="appt-row">
          <IconUser />
          <div>
            <div className="appt-label">Patient</div>
            <div className="appt-value">{result.patient.name}</div>
          </div>
        </div>
        <div className="appt-row">
          <IconClock />
          <div>
            <div className="appt-label">Appointment</div>
            <div className="appt-value">{result.patient.appointment_time}</div>
          </div>
        </div>
        <div className="appt-row">
          <IconScan />
          <div>
            <div className="appt-label">Doctor · Department</div>
            <div className="appt-value">{result.patient.doctor} · {result.patient.department}</div>
          </div>
        </div>
      </div>

      <div className="appt-ids">
        <span>Patient ID: <b>{result.patient.patient_id}</b></span>
        <span>Ref: <b>{result.patient.appointment_id}</b></span>
      </div>

      <button className="btn-reset" onClick={onReset}>Scan Again</button>
    </div>
  );
}

// ── Camera view ───────────────────────────────────────────────────────────────
function CameraView({ onCapture, loading }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [countdown, setCountdown] = useState(null);

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
        setCamErr("Camera access denied. Please allow camera permissions and refresh.");
      }
    })();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  const capture = useCallback(() => {
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
  }, [streaming, onCapture]);

  return (
    <div className="camera-wrap">
      {camErr ? (
        <div className="cam-error">
          <IconX />
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
          <button className="btn-capture" onClick={capture} disabled={loading || !streaming || countdown !== null}>
            {loading ? (
              <><span className="spinner" /> Verifying…</>
            ) : countdown ? (
              `Hold still… ${countdown}`
            ) : (
              <><IconCamera /> Capture & Verify</>
            )}
          </button>
          <p className="cam-hint">Position your face within the frame and hold still</p>
        </>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("idle"); // idle | scanning | success | error
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
      setError("Cannot reach the server. Is face_service.py running on port 5050?");
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
      <style>{styles}</style>
      <div className="shell">
        <header className="hdr">
          <div className="hdr-logo"><IconScan /><span>MediPass</span></div>
          <div className="hdr-tag">Digital Token System</div>
        </header>

        <main className="main">
          {phase === "success" ? (
            <TokenCard result={result} onReset={reset} />
          ) : (
            <div className="card">
              <div className="card-top">
                <h1 className="card-title">Face Verification</h1>
                <p className="card-desc">
                  Look at the camera to retrieve your digital appointment token instantly —
                  no paper slips, no queues.
                </p>
              </div>

              <CameraView onCapture={handleCapture} loading={loading} />

              {phase === "error" && (
                <div className="error-bar">
                  <IconX />
                  <span>{error}</span>
                  <button className="btn-retry" onClick={reset}>Retry</button>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="ftr">Powered by InsightFace · Secure · On-premise</footer>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #030712;
    color: #e2e8f0;
    font-family: 'Inter', system-ui, sans-serif;
    min-height: 100dvh;
  }

  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #0f1f3d 0%, #030712 70%);
  }

  /* Header */
  .hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 32px;
    border-bottom: 1px solid #1e293b;
    backdrop-filter: blur(8px);
    background: rgba(3,7,18,0.7);
    position: sticky; top: 0; z-index: 10;
  }
  .hdr-logo { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 18px; color: #38bdf8; }
  .hdr-tag { font-size: 12px; color: #475569; letter-spacing: 0.08em; text-transform: uppercase; }

  /* Main */
  .main {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    padding: 32px 16px;
  }

  /* Card */
  .card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 20px;
    padding: 32px;
    width: 100%; max-width: 520px;
    box-shadow: 0 0 60px rgba(56,189,248,0.05);
  }
  .card-top { margin-bottom: 24px; }
  .card-title { font-size: 24px; font-weight: 700; color: #f8fafc; margin-bottom: 8px; }
  .card-desc { font-size: 14px; color: #64748b; line-height: 1.6; }

  /* Camera */
  .camera-wrap { display: flex; flex-direction: column; gap: 16px; }
  .video-frame {
    position: relative; border-radius: 14px; overflow: hidden;
    aspect-ratio: 4/3; background: #020617;
    border: 1px solid #1e293b;
  }
  .video-el { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }

  /* Scan corners */
  .scan-overlay {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .scan-corner {
    position: absolute; width: 28px; height: 28px;
    border-color: #38bdf8; border-style: solid; opacity: 0.8;
  }
  .scan-corner.tl { top: 16px; left: 16px; border-width: 2px 0 0 2px; border-radius: 4px 0 0 0; }
  .scan-corner.tr { top: 16px; right: 16px; border-width: 2px 2px 0 0; border-radius: 0 4px 0 0; }
  .scan-corner.bl { bottom: 16px; left: 16px; border-width: 0 0 2px 2px; border-radius: 0 0 0 4px; }
  .scan-corner.br { bottom: 16px; right: 16px; border-width: 0 2px 2px 0; border-radius: 0 0 4px 0; }

  .countdown {
    font-size: 72px; font-weight: 800; color: #38bdf8;
    text-shadow: 0 0 40px #38bdf8; font-family: monospace;
    animation: pop 0.3s ease;
  }
  @keyframes pop { from { transform: scale(1.4); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }

  .btn-capture {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; padding: 14px;
    background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
    color: #fff; font-weight: 600; font-size: 15px;
    border: none; border-radius: 12px; cursor: pointer;
    transition: opacity 0.2s, transform 0.1s;
    box-shadow: 0 4px 20px rgba(14,165,233,0.25);
  }
  .btn-capture:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .btn-capture:disabled { opacity: 0.5; cursor: not-allowed; }

  .cam-hint { font-size: 12px; color: #475569; text-align: center; }
  .cam-error {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 40px 20px; color: #ef4444; text-align: center; font-size: 14px;
  }

  /* Spinner */
  .spinner {
    width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff; border-radius: 50%;
    animation: spin 0.7s linear infinite; display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error bar */
  .error-bar {
    display: flex; align-items: center; gap: 10px;
    background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25);
    border-radius: 10px; padding: 12px 14px;
    color: #fca5a5; font-size: 13px; margin-top: 8px;
  }
  .btn-retry {
    margin-left: auto; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.4);
    color: #fca5a5; padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;
    white-space: nowrap;
  }

  /* Token card */
  .token-card {
    position: relative; overflow: hidden;
    background: #0f172a; border: 1px solid #1e3a5f;
    border-radius: 20px; padding: 32px;
    width: 100%; max-width: 520px;
    box-shadow: 0 0 80px rgba(56,189,248,0.08);
  }
  .token-glow {
    position: absolute; top: -60px; left: 50%; transform: translateX(-50%);
    width: 300px; height: 120px; border-radius: 50%;
    background: radial-gradient(ellipse, rgba(56,189,248,0.12) 0%, transparent 70%);
    pointer-events: none;
  }
  .token-header {
    display: flex; align-items: center; gap: 16px; margin-bottom: 28px;
  }
  .token-check {
    width: 44px; height: 44px; background: rgba(34,197,94,0.15); border-radius: 50%;
    display: flex; align-items: center; justify-content: center; color: #22c55e;
    flex-shrink: 0;
    border: 1px solid rgba(34,197,94,0.3);
  }
  .token-title { font-size: 20px; font-weight: 700; color: #f8fafc; }
  .token-sub { font-size: 13px; color: #64748b; margin-top: 2px; }

  .token-badge {
    display: flex; align-items: center; gap: 10px;
    background: linear-gradient(135deg, rgba(14,165,233,0.1), rgba(99,102,241,0.1));
    border: 1px solid rgba(56,189,248,0.25);
    border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;
    cursor: pointer; transition: border-color 0.2s;
    color: #38bdf8;
  }
  .token-badge:hover { border-color: rgba(56,189,248,0.5); }
  .token-value { font-family: 'JetBrains Mono', monospace; font-size: 22px; font-weight: 700; color: #f8fafc; flex: 1; }
  .copy-hint { font-size: 11px; color: #64748b; margin-left: auto; }

  /* Appointment grid */
  .appt-grid { display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px; }
  .appt-row { display: flex; align-items: flex-start; gap: 12px; color: #64748b; }
  .appt-row svg { flex-shrink: 0; margin-top: 2px; }
  .appt-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }
  .appt-value { font-size: 14px; color: #cbd5e1; margin-top: 2px; font-weight: 500; }

  .appt-ids {
    display: flex; gap: 16px; flex-wrap: wrap;
    font-size: 11px; color: #475569;
    padding-top: 16px; border-top: 1px solid #1e293b;
    margin-bottom: 20px;
  }
  .appt-ids b { color: #64748b; }

  .btn-reset {
    width: 100%; padding: 11px;
    background: transparent; border: 1px solid #1e293b;
    color: #64748b; border-radius: 10px; cursor: pointer; font-size: 13px;
    transition: border-color 0.2s, color 0.2s;
  }
  .btn-reset:hover { border-color: #38bdf8; color: #38bdf8; }

  /* Footer */
  .ftr { text-align: center; padding: 16px; font-size: 11px; color: #1e293b; }

  @media (max-width: 540px) {
    .hdr { padding: 12px 16px; }
    .card, .token-card { padding: 20px; border-radius: 14px; }
    .token-value { font-size: 17px; }
  }
`;
