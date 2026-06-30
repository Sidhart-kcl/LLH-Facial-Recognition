import { useState, useRef, useCallback, useEffect } from "react";

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
const IconUpload = () => <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />;
const IconToken = () => <Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;
const IconUser = () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;

// ── Step 1: Patient Info ───────────────────────────────────────────────────
function StepInfo({ onNext }) {
  const [form, setForm] = useState({
    name: "",
    doctor: "",
    department: "",
    appointment_time: "",
  });
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = Object.entries(form).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      setError(`Missing: ${missing.join(", ")}`);
      return;
    }
    onNext(form);
  };

  return (
    <div className="step-container">
      <div className="step-header">
        <div className="step-number">1</div>
        <div>
          <h2>Appointment Details</h2>
          <p>Fill in your appointment information</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="booking-form">
        <div className="form-group">
          <label><IconUser /> Your Name</label>
          <input
            type="text"
            name="name"
            placeholder="John Doe"
            value={form.name}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label>Doctor</label>
          <input
            type="text"
            name="doctor"
            placeholder="Dr. Sarah Smith"
            value={form.doctor}
            onChange={handleChange}
            required
          />
        </div>

        <div className="form-group">
          <label>Department</label>
          <select
            name="department"
            value={form.department}
            onChange={handleChange}
            required
          >
            <option value="">Select Department</option>
            <option value="Cardiology">Cardiology</option>
            <option value="Neurology">Neurology</option>
            <option value="Orthopedics">Orthopedics</option>
            <option value="Dermatology">Dermatology</option>
            <option value="Pediatrics">Pediatrics</option>
            <option value="General">General</option>
          </select>
        </div>

        <div className="form-group">
          <label><IconCalendar /> Appointment Time</label>
          <input
            type="datetime-local"
            name="appointment_time"
            value={form.appointment_time}
            onChange={handleChange}
            required
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" className="btn-primary">
          Next: Register Face →
        </button>
      </form>
    </div>
  );
}

// ── Step 2: Face Capture ───────────────────────────────────────────────────
function StepFaceCapture({ form, onNext, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [captured, setCaptured] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [uploadMode, setUploadMode] = useState(false);

  useEffect(() => {
    let stream;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
        });
        if (videoRef.current && !uploadMode) {
          videoRef.current.srcObject = stream;
          setStreaming(true);
        }
      } catch (e) {
        setCamErr("Camera access denied. You can upload a photo instead.");
      }
    })();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, [uploadMode]);

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
      setCaptured(canvas.toDataURL("image/jpeg", 0.92));
    }, 1000);
  }, [streaming]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCaptured(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!captured) {
      alert("Please capture or upload a photo first");
      return;
    }
    onNext(captured);
  };

  return (
    <div className="step-container">
      <div className="step-header">
        <div className="step-number">2</div>
        <div>
          <h2>Face Registration</h2>
          <p>Capture or upload a clear photo of your face</p>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${!uploadMode ? "active" : ""}`}
          onClick={() => setUploadMode(false)}
        >
          <IconCamera /> Capture
        </button>
        <button
          className={`tab ${uploadMode ? "active" : ""}`}
          onClick={() => setUploadMode(true)}
        >
          <IconUpload /> Upload
        </button>
      </div>

      {!uploadMode ? (
        // Camera capture mode
        <div className="camera-section">
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
              <button
                className="btn-primary"
                onClick={capture}
                disabled={!streaming || countdown !== null}
              >
                {countdown ? `Hold still… ${countdown}` : "Capture Photo"}
              </button>
              <p className="hint">Position your face in the center, ensure good lighting</p>
            </>
          )}
        </div>
      ) : (
        // Upload mode
        <div className="upload-section">
          <label className="upload-box">
            <IconUpload />
            <span>Click to upload or drag and drop</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </label>
          <p className="hint">JPG, PNG, up to 10MB</p>
        </div>
      )}

      {captured && (
        <div className="preview-section">
          <h3>Preview</h3>
          <img src={captured} alt="Captured face" className="preview-image" />
          <button
            className="btn-secondary"
            onClick={() => setCaptured(null)}
          >
            Retake
          </button>
        </div>
      )}

      <div className="step-actions">
        <button className="btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={!captured}
        >
          Next: Confirm Token →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Confirmation with Token ────────────────────────────────────────
function StepConfirmation({ form, faceImage, onComplete, onRetry }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const bookAndRegister = async () => {
      try {
        setLoading(true);

        // Step 1: Book appointment
        console.log("📋 Booking appointment...");
        const bookRes = await fetch(`${API}/book`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });

        if (!bookRes.ok) {
          throw new Error("Failed to book appointment");
        }

        const bookData = await bookRes.json();
        const patientId = bookData.patient_id;

        console.log("✅ Appointment booked:", patientId);

        // Step 2: Register face
        console.log("📸 Registering face...");
        const registerRes = await fetch(`${API}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            image: faceImage,
          }),
        });

        if (!registerRes.ok) {
          throw new Error("Failed to register face");
        }

        const registerData = await registerRes.json();

        console.log("✅ Face registered");

        // Success!
        setResult({
          ...bookData,
          patient_id: patientId,
        });

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to complete booking");
        setLoading(false);
      }
    };

    bookAndRegister();
  }, [form, faceImage]);

  if (loading) {
    return (
      <div className="step-container">
        <div className="loading-state">
          <div className="spinner-large" />
          <h2>Processing Your Booking...</h2>
          <p>Creating appointment and registering your face</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="step-container">
        <div className="error-state">
          <IconX />
          <h2>Something Went Wrong</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={onRetry}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="step-container">
        <div className="success-state">
          <div className="check-icon"><IconCheck /></div>
          <h2>Booking Complete! ✅</h2>

          <div className="confirmation-card">
            <div className="section">
              <h3>Patient Information</h3>
              <div className="info-row">
                <span className="label">Name:</span>
                <span className="value">{form.name}</span>
              </div>
              <div className="info-row">
                <span className="label">Patient ID:</span>
                <span className="value code">{result.patient_id}</span>
              </div>
              <div className="info-row">
                <span className="label">Appointment ID:</span>
                <span className="value code">{result.appointment_id}</span>
              </div>
            </div>

            <div className="divider" />

            <div className="section">
              <h3>Your Digital Token</h3>
              <div className="token-display">
                <IconToken />
                <div className="token-value">{result.digital_token}</div>
                <p className="token-hint">Show this at check-in or scan your face</p>
              </div>
            </div>

            <div className="divider" />

            <div className="section">
              <h3>Appointment Details</h3>
              <div className="info-row">
                <span className="label">Doctor:</span>
                <span className="value">{form.doctor}</span>
              </div>
              <div className="info-row">
                <span className="label">Department:</span>
                <span className="value">{form.department}</span>
              </div>
              <div className="info-row">
                <span className="label">Time:</span>
                <span className="value">
                  {new Date(form.appointment_time).toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div className="instructions">
            <h4>What's Next?</h4>
            <ol>
              <li>Your face has been registered ✅</li>
              <li>At check-in, scan your face at any kiosk</li>
              <li>Your token will appear instantly</li>
              <li>Show it to the receptionist</li>
            </ol>
          </div>

          <button className="btn-primary" onClick={onComplete}>
            Done - Go to Check-In
          </button>
        </div>
      </div>
    );
  }
}

// ── Main Booking Component ────────────────────────────────────────────────
export default function BookingFlow({ onComplete }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState(null);
  const [faceImage, setFaceImage] = useState(null);

  const resetFlow = () => {
    setStep(1);
    setFormData(null);
    setFaceImage(null);
  };

  return (
    <>
      <style>{styles}</style>
      <div className="booking-shell">
        <header className="booking-header">
          <h1>🏥 MediPass Booking</h1>
          <p>Book appointment • Register face • Get digital token</p>
        </header>

        <main className="booking-main">
          {step === 1 && (
            <StepInfo
              onNext={(data) => {
                setFormData(data);
                setStep(2);
              }}
            />
          )}

          {step === 2 && formData && (
            <StepFaceCapture
              form={formData}
              onNext={(image) => {
                setFaceImage(image);
                setStep(3);
              }}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && formData && faceImage && (
            <StepConfirmation
              form={formData}
              faceImage={faceImage}
              onComplete={() => {
                resetFlow();
                onComplete?.();
              }}
              onRetry={resetFlow}
            />
          )}
        </main>

        <footer className="booking-footer">
          Your face is securely registered • No data sent to cloud
        </footer>
      </div>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles = `
  .booking-shell {
    min-height: 100dvh;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, #0f1f3d 0%, #030712 70%);
    display: flex;
    flex-direction: column;
  }

  .booking-header {
    background: rgba(3, 7, 18, 0.9);
    border-bottom: 1px solid #1e293b;
    padding: 24px;
    text-align: center;
  }

  .booking-header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #38bdf8;
    margin-bottom: 4px;
  }

  .booking-header p {
    font-size: 13px;
    color: #64748b;
  }

  .booking-main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
  }

  .step-container {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 20px;
    padding: 32px;
    width: 100%;
    max-width: 600px;
    box-shadow: 0 0 60px rgba(56, 189, 248, 0.05);
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 32px;
  }

  .step-number {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #0ea5e9, #6366f1);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .step-header h2 {
    font-size: 22px;
    font-weight: 700;
    color: #f8fafc;
    margin-bottom: 4px;
  }

  .step-header p {
    font-size: 13px;
    color: #64748b;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
  }

  .tab {
    flex: 1;
    padding: 12px;
    background: #1a2332;
    border: 1px solid #1e293b;
    border-radius: 10px;
    color: #64748b;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s;
  }

  .tab.active {
    background: rgba(14, 165, 233, 0.15);
    border-color: #38bdf8;
    color: #38bdf8;
  }

  /* Form */
  .booking-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-group label {
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .form-group input,
  .form-group select {
    padding: 10px 12px;
    background: #1a2332;
    border: 1px solid #1e293b;
    border-radius: 8px;
    color: #f8fafc;
    font-size: 14px;
    transition: border-color 0.2s;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #38bdf8;
    background: #0f1a2a;
  }

  /* Camera */
  .camera-section,
  .upload-section {
    margin-bottom: 24px;
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
    font-size: 64px;
    font-weight: 800;
    color: #38bdf8;
    text-shadow: 0 0 40px #38bdf8;
  }

  .upload-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    border: 2px dashed #1e293b;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
    background: #1a2332;
  }

  .upload-box:hover {
    border-color: #38bdf8;
    background: #0f1a2a;
  }

  .upload-box svg {
    width: 40px;
    height: 40px;
    color: #38bdf8;
    margin-bottom: 12px;
  }

  .upload-box span {
    color: #cbd5e1;
    font-size: 13px;
    text-align: center;
  }

  .hint {
    font-size: 12px;
    color: #475569;
    text-align: center;
  }

  /* Preview */
  .preview-section {
    margin: 24px 0;
    padding-top: 24px;
    border-top: 1px solid #1e293b;
  }

  .preview-section h3 {
    font-size: 13px;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .preview-image {
    width: 100%;
    border-radius: 10px;
    margin-bottom: 12px;
    max-height: 300px;
    object-fit: cover;
  }

  /* Buttons */
  .btn-primary, .btn-secondary {
    padding: 12px 16px;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .btn-primary {
    background: linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%);
    color: white;
    width: 100%;
    box-shadow: 0 4px 20px rgba(14, 165, 233, 0.25);
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: transparent;
    border: 1px solid #1e293b;
    color: #64748b;
    width: 100%;
  }

  .btn-secondary:hover {
    border-color: #38bdf8;
    color: #38bdf8;
  }

  /* Step Actions */
  .step-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .step-actions .btn-secondary {
    flex: 1;
  }

  .step-actions .btn-primary {
    flex: 2;
  }

  /* Loading State */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    text-align: center;
  }

  .spinner-large {
    width: 48px;
    height: 48px;
    border: 3px solid rgba(56, 189, 248, 0.3);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 20px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-state h2 {
    font-size: 18px;
    color: #f8fafc;
    margin-bottom: 8px;
  }

  .loading-state p {
    font-size: 13px;
    color: #64748b;
  }

  /* Error State */
  .error-state,
  .success-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
  }

  .error-state svg {
    width: 48px;
    height: 48px;
    color: #ef4444;
    margin-bottom: 16px;
  }

  .error-state h2 {
    font-size: 18px;
    color: #f8fafc;
    margin-bottom: 8px;
  }

  .error-state p {
    font-size: 13px;
    color: #64748b;
    margin-bottom: 16px;
  }

  /* Success State */
  .check-icon {
    width: 64px;
    height: 64px;
    background: rgba(34, 197, 94, 0.15);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  .check-icon svg {
    width: 40px;
    height: 40px;
    color: #22c55e;
  }

  .success-state h2 {
    font-size: 24px;
    font-weight: 700;
    color: #22c55e;
    margin-bottom: 24px;
  }

  .confirmation-card {
    background: rgba(34, 197, 94, 0.05);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 12px;
    padding: 20px;
    margin: 24px 0;
    text-align: left;
  }

  .section {
    margin-bottom: 16px;
  }

  .section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    font-size: 13px;
  }

  .info-row .label {
    color: #64748b;
  }

  .info-row .value {
    color: #cbd5e1;
    font-weight: 500;
  }

  .info-row .value.code {
    font-family: monospace;
    background: rgba(56, 189, 248, 0.1);
    padding: 2px 8px;
    border-radius: 4px;
    color: #38bdf8;
  }

  .divider {
    height: 1px;
    background: rgba(34, 197, 94, 0.2);
    margin: 16px 0;
  }

  .token-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 20px;
    background: rgba(56, 189, 248, 0.1);
    border-radius: 10px;
    border: 1px solid rgba(56, 189, 248, 0.2);
  }

  .token-display svg {
    color: #38bdf8;
  }

  .token-value {
    font-family: 'JetBrains Mono', monospace;
    font-size: 18px;
    font-weight: 700;
    color: #38bdf8;
    letter-spacing: 2px;
  }

  .token-hint {
    font-size: 11px;
    color: #64748b;
  }

  .instructions {
    background: #1a2332;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 16px;
    margin: 20px 0;
    text-align: left;
  }

  .instructions h4 {
    font-size: 12px;
    font-weight: 600;
    color: #cbd5e1;
    margin-bottom: 8px;
  }

  .instructions ol {
    font-size: 12px;
    color: #64748b;
    padding-left: 20px;
  }

  .instructions li {
    margin: 4px 0;
  }

  /* Error message */
  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #fca5a5;
    padding: 10px;
    border-radius: 8px;
    font-size: 12px;
  }

  .cam-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 20px;
    color: #ef4444;
    text-align: center;
    font-size: 13px;
  }

  .booking-footer {
    text-align: center;
    padding: 16px;
    font-size: 11px;
    color: #1e293b;
  }

  @media (max-width: 540px) {
    .step-container { padding: 20px; }
    .booking-header { padding: 16px; }
    .booking-header h1 { font-size: 22px; }
  }
`;
