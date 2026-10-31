import { useId, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import type { EffortSliderVariantProps } from "./types";

const trackInsetPx = 12;

export function ClassicEffortSlider({
  options,
  value,
  label,
  disabled,
  onPreview,
  onCommit,
}: EffortSliderVariantProps) {
  const sliderId = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const lastIndex = Math.max(0, options.length - 1);
  const activeIndex = value;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const indexFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return activeIndex;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - trackInsetPx * 2;
    if (usable <= 0) return activeIndex;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - trackInsetPx) / usable));
    return Math.round(ratio * lastIndex);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !trackRef.current) return;
    trackRef.current.setPointerCapture(event.pointerId);
    setDragging(true);
    onPreview(indexFromPointer(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const index = indexFromPointer(event.clientX);
    if (dragging) onPreview(index);
    else if (!disabled && event.pointerType === "mouse") setHoverIndex(index);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    onCommit(indexFromPointer(event.clientX));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    let next = activeIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = activeIndex + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = activeIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = lastIndex;
    else return;
    event.preventDefault();
    next = Math.min(lastIndex, Math.max(0, next));
    if (next !== activeIndex) onCommit(next);
  };

  const current = options[activeIndex] ?? options[0];
  const percent = lastIndex > 0 ? (activeIndex / lastIndex) * 100 : 0;
  const previewIndex = hoverIndex !== null && hoverIndex !== activeIndex ? hoverIndex : null;

  return (
    <div data-dragging={dragging ? "true" : undefined}>
      <div
        ref={trackRef}
        id={sliderId}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={lastIndex}
        aria-valuenow={activeIndex}
        aria-valuetext={current?.label}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={onKeyDown}
        className={cn(
          "group relative flex h-9 w-full cursor-pointer touch-none select-none items-center rounded-full px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <div className="relative h-2 w-full rounded-full bg-foreground/10 shadow-inner">
          <div
            className={cn(
              "absolute inset-y-0 start-0 rounded-full bg-linear-to-r from-brand/5 via-brand/60 to-brand shadow-md shadow-brand/40",
              !dragging && "transition-[width] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={{ width: `${percent}%` }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-between">
            {options.map((option, index) => (
              <span
                key={option.id}
                className={cn(
                  "size-1.5 rounded-full transition-colors duration-200",
                  index < activeIndex && "bg-white/80",
                  index === activeIndex && "bg-transparent",
                  index > activeIndex &&
                    (index === previewIndex ? "bg-foreground/55" : "bg-foreground/25"),
                )}
              />
            ))}
          </div>
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-white shadow-lg shadow-brand/50 ring-4 ring-brand/20",
              dragging
                ? "scale-110"
                : "transition-[left,scale] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>

      {options.length > 1 ? (
        <div className="relative mx-3 h-4">
          {options.map((option, index) => (
            <span
              key={option.id}
              className={cn(
                "absolute top-0 whitespace-nowrap text-2xs transition-colors duration-200",
                index === 0
                  ? "translate-x-0"
                  : index === lastIndex
                    ? "-translate-x-full"
                    : "-translate-x-1/2",
                index === activeIndex ? "font-semibold text-brand" : "text-muted-foreground",
              )}
              style={{ left: `${lastIndex > 0 ? (index / lastIndex) * 100 : 0}%` }}
            >
              {option.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
