import { useEffect, useRef, useState } from 'react';
import { captureFrame, prepareUpload } from '../lib/image';
import { Button, Shell } from './ui';

interface Props {
  onBack: () => void;
  onPhoto: (blob: Blob) => void;
}

type Mode = 'starting' | 'live' | 'fallback';

export function PhotoStep({ onBack, onPhoto }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('starting');
  const [flash, setFlash] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setMode('fallback');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => undefined);
        }
        setMode('live');
      })
      .catch(() => !cancelled && setMode('fallback'));

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busy) return;
    setBusy(true);
    setFlash((n) => n + 1);
    try {
      onPhoto(await captureFrame(video));
    } catch {
      setProblem("The photo didn't save. Try again.");
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      onPhoto(await prepareUpload(file));
    } catch {
      setProblem('That photo is too large. Try a smaller one.');
      setBusy(false);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      capture="user"
      className="sr-only"
      onChange={(e) => void onFile(e.target.files?.[0])}
    />
  );

  if (mode === 'fallback') {
    return (
      <Shell
        step={3}
        onBack={onBack}
        title="Take a selfie"
        hint="Your camera isn't available in the browser, so we'll open your phone's camera instead."
        actions={
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Preparing…' : 'Open camera'}
          </Button>
        }
      >
        {fileInput}
        <div className="grid flex-1 place-items-center rounded-card border border-dashed border-white/15 bg-surface/60 p-8 text-center text-sm text-muted">
          Face the light and hold the phone at eye level.
        </div>
        {problem ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {problem}
          </p>
        ) : null}
      </Shell>
    );
  }

  return (
    <Shell
      step={3}
      onBack={onBack}
      title="Take a selfie"
      hint="Fit your face inside the oval, facing the light."
      actions={
        <Button disabled={mode !== 'live' || busy} onClick={() => void shoot()}>
          {mode === 'starting' ? 'Starting camera…' : 'Take photo'}
        </Button>
      }
    >
      <div className="relative mx-auto aspect-3/4 w-full overflow-hidden rounded-card bg-surface">
        <video
          ref={videoRef}
          playsInline
          muted
          className="size-full -scale-x-100 object-cover"
          aria-label="Camera preview"
        />
        <svg
          viewBox="0 0 300 400"
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden
        >
          <defs>
            <mask id="oval-cut">
              <rect width="300" height="400" fill="white" />
              <ellipse cx="150" cy="178" rx="98" ry="128" fill="black" />
            </mask>
          </defs>
          <rect width="300" height="400" fill="rgba(11,13,18,0.55)" mask="url(#oval-cut)" />
          <ellipse
            cx="150"
            cy="178"
            rx="98"
            ry="128"
            fill="none"
            stroke="#E8B86D"
            strokeWidth="2.5"
          />
        </svg>
        {flash > 0 ? <div key={flash} className="shutter absolute inset-0 bg-white" /> : null}
      </div>
      {fileInput}
      {problem ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </Shell>
  );
}
