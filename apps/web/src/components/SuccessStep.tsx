import { useEffect, useMemo } from 'react';
import type { VisitResponse } from '@guest-slideshow/shared';
import { Button, Shell } from './ui';

interface Props {
  result: VisitResponse;
  photo: Blob;
  onAnother: () => void;
}

export function SuccessStep({ result, photo, onAnother }: Props) {
  const url = useMemo(() => URL.createObjectURL(photo), [photo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const pending = result.status === 'pending';

  return (
    <Shell
      title={pending ? 'Thanks, we have it' : "You're on the big screen"}
      hint={
        pending
          ? 'Your photo will appear after the host approves it.'
          : `Look up. ${result.name}, you're up next on the screens around the house.`
      }
      actions={
        result.remainingToday > 0 ? (
          <Button variant="quiet" onClick={onAnother}>
            Take another photo
          </Button>
        ) : undefined
      }
    >
      <div className="grid flex-1 place-items-center">
        <div className="w-full">
          {/* A little television with the guest's own photo: the one memorable moment. */}
          <div className="tv-on mx-auto w-full max-w-[19rem] rounded-[22px] border border-white/12 bg-surface p-2.5 shadow-[0_30px_60px_-30px_rgba(232,184,109,0.35)]">
            <div className="relative aspect-video overflow-hidden rounded-[14px] bg-black">
              <img
                src={url}
                alt=""
                className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-xl"
              />
              <img
                src={url}
                alt={`Photo of ${result.name}`}
                className="relative size-full object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent px-3 pb-2 pt-6 text-sm font-bold">
                {result.name}
              </div>
            </div>
          </div>
          <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-white/10" />
          <div className="mt-8 flex items-center justify-center gap-2.5 text-muted">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="#E8B86D" strokeWidth="2" />
              <path
                className="draw-check"
                d="M7.5 12.5l3 3 6-6.5"
                stroke="#E8B86D"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-sm">{pending ? 'Waiting for approval' : 'Sent'}</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}
