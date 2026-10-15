import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import type { AdminQr } from '@guest-slideshow/shared';
import { adminApi } from './api';
import { Card, Field, Notice, SmallButton, formatWhen, inputClass } from './ui';

const BASE_KEY = 'admin-guest-base-url';

function initialBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) || window.location.origin;
  } catch {
    return window.location.origin;
  }
}

export function QrPanel() {
  const [qr, setQr] = useState<AdminQr | null>(null);
  const [base, setBase] = useState(initialBase);
  const [image, setImage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminApi.qr().then(setQr, (e: Error) => setError(e.message));
  }, []);

  const url = qr ? `${base.replace(/\/+$/, '')}/?t=${qr.token}` : '';

  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' }).then(setImage, () =>
      setError('Could not draw the QR code.'),
    );
  }, [url]);

  const rotate = useCallback(async () => {
    if (
      !window.confirm('Rotate the QR code? The old printed code will stop working straight away.')
    )
      return;
    try {
      setQr(await adminApi.rotateQr());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate.');
    }
  }, []);

  function changeBase(value: string) {
    setBase(value);
    try {
      localStorage.setItem(BASE_KEY, value);
    } catch {
      /* optional convenience */
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_1fr]">
      <div id="qr-print" className="rounded-card bg-white p-5 text-center text-ink">
        {image ? (
          <img src={image} alt="Entrance QR code" className="mx-auto w-full max-w-80" />
        ) : (
          <div className="aspect-square" />
        )}
        <p className="mt-3 text-lg font-extrabold">Scan to join the screens</p>
        <p className="text-sm text-black/60">Add your photo and appear on the TVs</p>
      </div>

      <div className="space-y-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Card className="space-y-4">
          <Field label="Guest site address" hint="where guests open the link">
            <input
              className={inputClass}
              value={base}
              onChange={(e) => changeBase(e.target.value)}
            />
          </Field>
          <p className="text-sm text-muted">
            On a laptop this is <code className="text-fg">http://localhost:5173</code>. For phone
            testing, paste your tunnel address here (for example{' '}
            <code className="text-fg">https://your-name.trycloudflare.com</code>) and the code
            updates.
          </p>
          <p className="break-all rounded-control bg-ink p-3 text-sm text-muted">{url || '…'}</p>
          {qr ? (
            <p className="text-sm text-muted">
              This code works until {formatWhen(qr.validTo)}
              {qr.rotation === 'manual' ? '' : `, then a new one is made (${qr.rotation})`}.
            </p>
          ) : null}
        </Card>

        <div className="flex flex-wrap gap-2">
          <SmallButton
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => undefined);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </SmallButton>
          <a
            href={image}
            download="entrance-qr.png"
            className="inline-flex min-h-11 items-center rounded-control border border-white/12 bg-white/4 px-4 text-sm font-semibold"
          >
            Download PNG
          </a>
          <SmallButton onClick={() => window.print()}>Print</SmallButton>
          <SmallButton tone="danger" onClick={() => void rotate()}>
            Rotate code
          </SmallButton>
        </div>
      </div>
    </div>
  );
}
