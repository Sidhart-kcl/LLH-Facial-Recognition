import { useState, useRef, useCallback, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5050";
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : DATE_TIME_FORMATTER.format(date);
};

const FIELD_LABELS = {
  name: "name",
  doctor: "doctor",
  department: "department",
  appointment_date: "appointment date",
  appointment_clock: "appointment time",
};

const formatAppointmentDateInput = (value) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const parseAppointmentDate = (value) => {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return {
    day: String(day).padStart(2, "0"),
    month: String(month).padStart(2, "0"),
    year: String(year),
  };
};

// ── Icons ──────────────────────────────────────────────────────────────────
const Icon = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconCalendar = () => <Icon d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM16 3v4M8 3v4M3 10h18" />;
const IconCheck = () => <Icon d="M20 6L9 17l-5-5" />;
const IconX = () => <Icon d="M18 6L6 18M6 6l12 12" />;
const IconToken = () => <Icon d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />;
const IconUser = () => <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;

// ── Step 1: Patient Info ───────────────────────────────────────────────────
function StepInfo({ onNext }) {
  const [form, setForm] = useState({
    name: "",
    doctor: "",
    department: "",
    appointment_date: "",
    appointment_clock: "",
  });
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === "appointment_date" ? formatAppointmentDateInput(value) : value;
    setForm(prev => ({ ...prev, [name]: nextValue }));
    setError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const missing = Object.entries(form)
      .filter((entry) => !entry[1])
      .map(([key]) => FIELD_LABELS[key] || key);
    if (missing.length > 0) {
      setError(`Missing: ${missing.join(", ")}`);
      return;
    }

    const appointmentDate = parseAppointmentDate(form.appointment_date);
    if (!appointmentDate) {
      setError("Appointment date must be in dd/mm/yyyy format.");
      return;
    }

    onNext({
      name: form.name,
      doctor: form.doctor,
      department: form.department,
      appointment_time: `${appointmentDate.year}-${appointmentDate.month}-${appointmentDate.day}T${form.appointment_clock}`,
    });
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
          <label><IconCalendar /> Appointment Date And Time</label>
          <div className="date-time-row">
            <input
              type="text"
              name="appointment_date"
              placeholder="dd/mm/yyyy"
              inputMode="numeric"
              autoComplete="off"
              value={form.appointment_date}
              onChange={handleChange}
              required
            />
            <input
              type="time"
              name="appointment_clock"
              value={form.appointment_clock}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <button type="submit" className="btn-primary">
          Next: Register Face →
        </button>
      </form>
    </div>
  );
}

// ── Step 2: Guided Face Capture ────────────────────────────────────────────
const FACE_SCAN_STEPS = [
  { id: "forward", label: "Straight", instruction: "Look straight at the camera" },
  { id: "left", label: "Left", instruction: "Turn slightly left" },
  { id: "right", label: "Right", instruction: "Turn slightly right" },
];

function StepFaceCapture({ onNext, onBack }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const analyzeCanvasRef = useRef(null);
  const analyzingRef = useRef(false);
  const stableReadyRef = useRef(0);
  const captureLockRef = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [camErr, setCamErr] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [captures, setCaptures] = useState([]);
  const [poseStatus, setPoseStatus] = useState({
    ready: false,
    message: "Starting camera...",
  });
  const [complete, setComplete] = useState(false);

  const currentStep = FACE_SCAN_STEPS[currentIndex];

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
        setCamErr("Camera access denied. Please allow camera access to register your face.");
      }
    })();
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => {
    stableReadyRef.current = 0;
    captureLockRef.current = false;
    if (!complete) {
      setPoseStatus({
        ready: false,
        message: currentStep?.instruction || "Registration complete",
      });
    }
  }, [currentIndex, currentStep, complete]);

  const frameToImage = useCallback((quality = 0.82, scale = 1) => {
    const video = videoRef.current;
    const canvas = scale === 1 ? canvasRef.current : analyzeCanvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  const captureCurrentStep = useCallback((analysis) => {
    if (captureLockRef.current || !currentStep) return;

    const image = frameToImage(0.92, 1);
    if (!image) return;

    captureLockRef.current = true;
    stableReadyRef.current = 0;

    setCaptures(prev => {
      const next = [
        ...prev,
        {
          target: currentStep.id,
          label: currentStep.label,
          image,
          analysis,
        },
      ];

      if (next.length >= FACE_SCAN_STEPS.length) {
        setComplete(true);
        setPoseStatus({ ready: true, message: "All face angles captured." });
      } else {
        setCurrentIndex(next.length);
      }

      return next;
    });
  }, [currentStep, frameToImage]);

  const analyzeCurrentFrame = useCallback(async () => {
    if (!streaming || complete || !currentStep || analyzingRef.current || captureLockRef.current) {
      return;
    }

    const image = frameToImage(0.65, 0.55);
    if (!image) return;

    analyzingRef.current = true;
    try {
      const res = await fetch(`${API}/analyze-face-pose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          target: currentStep.id,
        }),
      });
      const data = await res.json();
      setPoseStatus(data);

      if (data.ready) {
        stableReadyRef.current += 1;
        if (stableReadyRef.current >= 3) {
          captureCurrentStep(data);
        }
      } else {
        stableReadyRef.current = 0;
      }
    } catch {
      stableReadyRef.current = 0;
      setPoseStatus({
        ready: false,
        message: "Cannot analyze face pose. Is backend running on port 5050?",
      });
    } finally {
      analyzingRef.current = false;
    }
  }, [captureCurrentStep, complete, currentStep, frameToImage, streaming]);

  useEffect(() => {
    if (!streaming || complete) return undefined;

    const interval = setInterval(analyzeCurrentFrame, 550);
    return () => clearInterval(interval);
  }, [analyzeCurrentFrame, complete, streaming]);

  const handleSubmit = () => {
    if (captures.length !== FACE_SCAN_STEPS.length) {
      return;
    }
    onNext(captures);
  };

  const resetScans = () => {
    stableReadyRef.current = 0;
    captureLockRef.current = false;
    setCaptures([]);
    setCurrentIndex(0);
    setComplete(false);
    setPoseStatus({
      ready: false,
      message: FACE_SCAN_STEPS[0].instruction,
    });
  };

  return (
    <div className="step-container">
      <div className="step-header">
        <div className="step-number">2</div>
        <div>
          <h2>Face Registration</h2>
          <p>Complete the three guided face scans</p>
        </div>
      </div>

      <div className="angle-progress">
        {FACE_SCAN_STEPS.map((step, index) => {
          const isDone = captures.some(capture => capture.target === step.id);
          const isActive = !isDone && index === currentIndex;
          return (
            <div
              key={step.id}
              className={`angle-step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}
            >
              <span>{isDone ? <IconCheck /> : index + 1}</span>
              <strong>{step.label}</strong>
            </div>
          );
        })}
      </div>

      <div className="camera-section">
        {camErr ? (
          <div className="cam-error">
            <IconX />
            <p>{camErr}</p>
          </div>
        ) : (
          <>
            <div className={`video-frame ${poseStatus.ready ? "ready" : ""}`}>
              <video ref={videoRef} autoPlay playsInline muted className="video-el" />
              <div className="scan-overlay">
                <div className="scan-corner tl" /><div className="scan-corner tr" />
                <div className="scan-corner bl" /><div className="scan-corner br" />
                <div className={`pose-status ${poseStatus.ready ? "ready" : ""}`}>
                  <strong>{complete ? "Complete" : currentStep?.label}</strong>
                  <span>{poseStatus.message}</span>
                  {!complete && (
                    <small>
                      Stability {Math.min(stableReadyRef.current, 3)}/3
                      {poseStatus.pose ? ` • yaw ${poseStatus.pose.yaw}` : ""}
                    </small>
                  )}
                </div>
              </div>
            </div>
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <canvas ref={analyzeCanvasRef} style={{ display: "none" }} />
            <p className="hint">
              The scan captures automatically when your face lines up and stays steady.
            </p>
          </>
        )}
      </div>

      {captures.length > 0 && (
        <div className="capture-review">
          <h3>Captured Angles</h3>
          <div className="capture-grid">
            {captures.map(capture => (
              <div className="capture-thumb" key={capture.target}>
                <img src={capture.image} alt={`${capture.label} face scan`} />
                <span>{capture.label}</span>
              </div>
            ))}
          </div>
          <button className="btn-secondary" onClick={resetScans}>
            Restart Scans
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
          disabled={captures.length !== FACE_SCAN_STEPS.length}
        >
          Next: Confirm Token →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Confirmation with Token ────────────────────────────────────────
function StepConfirmation({ form, faceCaptures, onComplete, onRetry }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const bookAndRegister = async () => {
      try {
        setLoading(true);

        // Create the appointment only if all three face scans register.
        const bookRes = await fetch(`${API}/book-with-face-set`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            images: faceCaptures.map(capture => capture.image),
          }),
        });

        const bookData = await bookRes.json();
        if (!bookRes.ok) {
          throw new Error(bookData.error || "Failed to book appointment");
        }

        const patientId = bookData.patient_id;

        // Success!
        setResult({
          ...bookData,
          patient_id: patientId,
          embedding_count: bookData.embedding_count,
        });

        setLoading(false);
      } catch (err) {
        console.error(err);
        setError(err.message || "Failed to complete booking");
        setLoading(false);
      }
    };

    bookAndRegister();
  }, [form, faceCaptures]);

  if (loading) {
    return (
      <div className="step-container">
        <div className="loading-state">
          <div className="spinner-large" />
          <h2>Processing Your Booking...</h2>
          <p>Creating appointment and registering three face angles</p>
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
              <h3>Face Registration</h3>
              <div className="info-row">
                <span className="label">Face samples:</span>
                <span className="value">{result.embedding_count || faceCaptures.length}</span>
              </div>
              <div className="registered-angles">
                {faceCaptures.map(capture => (
                  <span key={capture.target}>{capture.label}</span>
                ))}
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
                  {formatDateTime(form.appointment_time)}
                </span>
              </div>
            </div>
          </div>

          <div className="instructions">
            <h4>What&apos;s Next?</h4>
            <ol>
              <li>Your three face angles have been registered ✅</li>
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
  const [faceCaptures, setFaceCaptures] = useState(null);

  const resetFlow = () => {
    setStep(1);
    setFormData(null);
    setFaceCaptures(null);
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
              onNext={(captures) => {
                setFaceCaptures(captures);
                setStep(3);
              }}
              onBack={() => setStep(1)}
            />
          )}

          {step === 3 && formData && faceCaptures && (
            <StepConfirmation
              form={formData}
              faceCaptures={faceCaptures}
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

  .angle-progress {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 20px;
  }

  .angle-step {
    min-height: 68px;
    border: 1px solid #1e293b;
    border-radius: 10px;
    background: #1a2332;
    color: #64748b;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
  }

  .angle-step span {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid currentColor;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
  }

  .angle-step svg {
    width: 15px;
    height: 15px;
  }

  .angle-step.active {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.65);
    background: rgba(14, 165, 233, 0.12);
  }

  .angle-step.done {
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.5);
    background: rgba(34, 197, 94, 0.1);
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

  .date-time-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px;
    gap: 10px;
  }

  @media (max-width: 520px) {
    .date-time-row {
      grid-template-columns: 1fr;
    }
  }

  /* Camera */
  .camera-section {
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

  .video-frame.ready {
    border-color: #22c55e;
    box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.35), 0 0 28px rgba(34, 197, 94, 0.16);
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

  .pose-status {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 16px;
    background: rgba(3, 7, 18, 0.84);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
  }

  .pose-status strong {
    color: #f8fafc;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .pose-status span {
    color: #cbd5e1;
    font-size: 13px;
  }

  .pose-status small {
    color: #64748b;
    font-size: 11px;
  }

  .pose-status.ready {
    border-color: rgba(34, 197, 94, 0.55);
    background: rgba(20, 83, 45, 0.72);
  }

  .hint {
    font-size: 12px;
    color: #475569;
    text-align: center;
  }

  .capture-review {
    margin: 20px 0 0;
    padding: 16px;
    background: #1a2332;
    border: 1px solid #1e293b;
    border-radius: 12px;
  }

  .capture-review h3 {
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }

  .capture-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }

  .capture-thumb {
    border-radius: 10px;
    overflow: hidden;
    background: #020617;
    border: 1px solid #1e293b;
  }

  .capture-thumb img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: block;
  }

  .capture-thumb span {
    display: block;
    padding: 7px 8px;
    color: #cbd5e1;
    font-size: 11px;
    text-align: center;
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

  .registered-angles {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .registered-angles span {
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.28);
    color: #86efac;
    font-size: 11px;
    font-weight: 700;
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
