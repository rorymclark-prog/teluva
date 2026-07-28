import { useState } from 'react';
import { Type } from 'lucide-react';
import {
  TEXT_SCALES,
  TEXT_SCALE_LABELS,
  getTextScaleIndex,
  setTextScaleIndex,
  applyTextScale,
} from '../utils/textScale';

/**
 * Text size — a slider with detents rather than a free one.
 *
 * A continuous slider sounds friendlier but hands back arbitrary values like
 * 1.07x, which nobody can hit twice and which land text on half-pixels. Five
 * fixed steps behave like a slider to the thumb, and every stop is a size the
 * layout has actually been looked at.
 *
 * The change applies live as you drag, because the only honest preview of a
 * text size is the screen you are already reading.
 */
export default function TextSizeControl() {
  const [index, setIndex] = useState(getTextScaleIndex);

  return (
    <div>
      <label className="field-label" htmlFor="text-size">Text size</label>

      {/* Sample line. Sized in the app's own body size, so it grows with the
          rest of the screen instead of pretending to be a preview. */}
      <div className="mb-3 rounded-2xl border border-cream-300 bg-cream-50 px-4 py-3">
        <p className="text-[13px] text-ink-700">Papa&apos;s passport expires in ~5 months</p>
      </div>

      <div className="flex items-center gap-3">
        <Type className="w-3 h-3 shrink-0 text-ink-400" aria-hidden="true" />
        <input
          id="text-size"
          type="range"
          min={0}
          max={TEXT_SCALES.length - 1}
          step={1}
          value={index}
          // Live while dragging; only written to storage on release, so a drag
          // across the whole track doesn't leave five entries behind.
          onChange={(e) => {
            const next = Number(e.target.value);
            setIndex(next);
            applyTextScale(next);
          }}
          onPointerUp={() => setTextScaleIndex(index)}
          onKeyUp={() => setTextScaleIndex(index)}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-cream-300 accent-clay-500"
          aria-valuetext={TEXT_SCALE_LABELS[index]}
        />
        <Type className="w-5 h-5 shrink-0 text-ink-400" aria-hidden="true" />
      </div>

      <p className="mt-2 text-[12px] text-ink-400">
        {TEXT_SCALE_LABELS[index]}
        {index === 1 && ' — what the app ships with'}
        <span className="block">Applies to this device only.</span>
      </p>
    </div>
  );
}
