import { useEffect, useMemo } from 'react';
import { Button, ErrorNote, Shell } from './ui';

interface Props {
  photo: Blob;
  name: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onRetake: () => void;
  onSubmit: () => void;
}

export function PreviewStep({ photo, name, busy, error, onBack, onRetake, onSubmit }: Props) {
  const url = useMemo(() => URL.createObjectURL(photo), [photo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <Shell
      step={4}
      onBack={busy ? undefined : onBack}
      title="Happy with this one?"
      hint="This is how you'll look on the screens."
      actions={
        <>
          <Button disabled={busy} onClick={onSubmit}>
            {busy ? 'Sending…' : 'Send to the screens'}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onRetake}>
            Retake
          </Button>
        </>
      }
    >
      <figure className="relative mx-auto w-full overflow-hidden rounded-card bg-surface">
        <img src={url} alt="Your photo" className="max-h-[52dvh] w-full object-contain" />
        <figcaption className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-5 pb-4 pt-12 text-xl font-bold">
          {name}
        </figcaption>
      </figure>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Shell>
  );
}
