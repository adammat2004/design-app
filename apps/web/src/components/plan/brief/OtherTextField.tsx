'use client';

import { useEffect, useRef } from 'react';
import { OTHER_LIMIT } from '@/lib/brief';

/**
 * The inline box revealed by an "Other" choice.
 *
 * Straight controlled input off the store, without the focused/unfocused resync `LengthInput`
 * and `NameField` carry. Those two exist because dragging on the canvas rewrites the value
 * while the user is typing into it; nothing writes these two fields except this input, so the
 * guard would be dead code.
 *
 * Autofocuses on reveal, because the click that revealed it was the user saying they had
 * something to type.
 */
export function OtherTextField({
  testId,
  label,
  placeholder,
  value,
  onChange,
}: {
  testId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <div className="mt-2 rounded-lg border border-dashed border-garden-line bg-garden-sage/40 px-2.5 py-2">
      <input
        ref={input}
        type="text"
        data-testid={testId}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={OTHER_LIMIT}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-xs text-garden-ink placeholder:text-garden-muted focus-visible:outline-none"
      />
    </div>
  );
}
