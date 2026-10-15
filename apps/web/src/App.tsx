import { useEffect, useState } from 'react';
import type { VisitResponse } from '@guest-slideshow/shared';
import { api, ApiClientError } from './api';
import { NameStep } from './components/NameStep';
import { PhoneStep } from './components/PhoneStep';
import { PhotoStep } from './components/PhotoStep';
import { PreviewStep } from './components/PreviewStep';
import { SuccessStep } from './components/SuccessStep';
import { Shell } from './components/ui';

type Step = 'phone' | 'name' | 'photo' | 'preview' | 'success';
type TokenState = 'checking' | 'valid' | 'invalid';

const TOKEN_KEY = 'guest-token';

function readToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('t');
  try {
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return fromUrl ?? '';
  }
}

export function App() {
  const [token] = useState(readToken);
  const [tokenState, setTokenState] = useState<TokenState>(token ? 'checking' : 'invalid');

  const [step, setStep] = useState<Step>('phone');
  const [countryIndex, setCountryIndex] = useState(0);
  const [national, setNational] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [returning, setReturning] = useState(false);
  const [consent, setConsent] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [result, setResult] = useState<VisitResponse | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .validate(token)
      .then((r) => setTokenState(r.valid ? 'valid' : 'invalid'))
      .catch(() => setTokenState('valid')); // offline blip: let them try, the server re-checks on submit
  }, [token]);

  if (tokenState === 'checking') {
    return <div className="grid min-h-dvh place-items-center text-muted">Loading…</div>;
  }
  if (tokenState === 'invalid') return <InvalidLink />;

  async function lookupPhone(e164: string) {
    setBusy(true);
    setError(null);
    setPhone(e164);
    try {
      const res = await api.lookup(e164, token);
      setReturning(res.known);
      if (res.known && res.firstName) setName((n) => n || res.firstName!);
      setStep('name');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'invalid_token') {
        setTokenState('invalid');
      } else if (err instanceof ApiClientError && err.code === 'invalid_phone') {
        setError(err.message);
      } else {
        // Lookup is only a convenience. If it fails, carry on without the autofill.
        setReturning(false);
        setStep('name');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.submitVisit({
          phone,
          name: name.trim(),
          consent: consent || returning,
          token,
          photo,
        }),
      );
      setStep('success');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'invalid_token') setTokenState('invalid');
      else setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  switch (step) {
    case 'phone':
      return (
        <PhoneStep
          countryIndex={countryIndex}
          national={national}
          busy={busy}
          error={error}
          onCountry={setCountryIndex}
          onNational={setNational}
          onContinue={lookupPhone}
        />
      );
    case 'name':
      return (
        <NameStep
          name={name}
          returning={returning}
          consent={consent}
          onName={setName}
          onConsent={setConsent}
          onBack={() => setStep('phone')}
          onContinue={() => setStep('photo')}
        />
      );
    case 'photo':
      return (
        <PhotoStep
          onBack={() => setStep('name')}
          onPhoto={(blob) => {
            setPhoto(blob);
            setError(null);
            setStep('preview');
          }}
        />
      );
    case 'preview':
      return photo ? (
        <PreviewStep
          photo={photo}
          name={name.trim()}
          busy={busy}
          error={error}
          onBack={() => setStep('photo')}
          onRetake={() => {
            setPhoto(null);
            setError(null);
            setStep('photo');
          }}
          onSubmit={() => void submit()}
        />
      ) : null;
    case 'success':
      return result && photo ? (
        <SuccessStep
          result={result}
          photo={photo}
          onAnother={() => {
            setPhoto(null);
            setResult(null);
            setReturning(true);
            setStep('photo');
          }}
        />
      ) : null;
  }
}

function InvalidLink() {
  return (
    <Shell
      title="Scan the QR code at the entrance"
      hint="This link has expired or is incomplete. The code by the front door opens a fresh one."
    >
      <div className="grid flex-1 place-items-center">
        <svg
          width="96"
          height="96"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="text-gold/80"
        >
          <path
            d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" />
        </svg>
      </div>
    </Shell>
  );
}
