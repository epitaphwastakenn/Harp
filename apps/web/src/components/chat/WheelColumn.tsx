import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  accumulateWheel,
  advanceTypeahead,
  clampIndex,
  currentTypeaheadBuffer,
  edgeEnabledIndex,
  findTypeaheadIndex,
  initialTypeahead,
  initialWheelAccumulator,
  isEnabledAt,
  isTypeaheadKey,
  nearestEnabledIndex,
  stepEnabledIndex,
  wheelDragThresholdPx,
  wheelPose,
  wheelPoseTransform,
  wheelVisibleRows,
  wheelWindow,
} from "./wheelPicker.logic";

export type WheelItem = {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string | null | undefined;
  readonly icon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly muted?: boolean | undefined;
  readonly title?: string | undefined;
};

type DragState = {
  readonly pointerId: number;
  readonly startY: number;
  readonly startPosition: number;
  readonly itemPx: number;
  moved: boolean;
  position: number;
};

const burstWindowMs = 120;
const mutedOpacity = 0.7;

export function WheelColumn(props: {
  label: string;
  items: ReadonlyArray<WheelItem>;
  selectedIndex: number;
  onSelect: (index: number, modifiers: { shiftKey: boolean }) => void;
  onActivate?: ((index: number) => void) | undefined;
  headerSlot?: ReactNode;
  headerAction?: ReactNode;
  listboxRef?: RefObject<HTMLDivElement | null> | undefined;
  className?: string | undefined;
}) {
  const {
    label,
    items,
    selectedIndex,
    onSelect,
    onActivate,
    headerSlot,
    headerAction,
    listboxRef,
    className,
  } = props;
  const baseId = useId();
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const lastMoveRef = useRef<{ index: number; at: number } | null>(null);
  const wheelStateRef = useRef(initialWheelAccumulator);
  const typeaheadRef = useRef(initialTypeahead);

  const dragging = dragPosition !== null;
  const position = dragPosition ?? Math.max(selectedIndex, 0);
  const center = clampIndex(position, items.length);
  const range = wheelWindow(items.length, center);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const moveFrom = (now: number) => {
    const last = lastMoveRef.current;
    return last !== null && now - last.at < burstWindowMs ? last.index : selectedIndex;
  };
  const moveTo = (index: number, now: number, shiftKey = false) => {
    if (!isEnabledAt(items, index)) return;
    if (index === moveFrom(now) && !shiftKey) return;
    lastMoveRef.current = { index, at: now };
    onSelect(index, { shiftKey });
  };
  const moveBy = (direction: 1 | -1, now: number) =>
    moveTo(stepEnabledIndex(items, moveFrom(now), direction), now);

  const attachWheel = (node: HTMLDivElement | null) => {
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const result = accumulateWheel(wheelStateRef.current, event);
      wheelStateRef.current = result.state;
      if (result.step !== 0) moveBy(result.step, event.timeStamp);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const now = event.timeStamp;
    if (event.key === "ArrowDown") {
      moveBy(1, now);
    } else if (event.key === "ArrowUp") {
      moveBy(-1, now);
    } else if (event.key === "Home") {
      moveTo(edgeEnabledIndex(items, "start"), now);
    } else if (event.key === "End") {
      moveTo(edgeEnabledIndex(items, "end"), now);
    } else {
      if (event.key === " ") event.preventDefault();
      const buffer = currentTypeaheadBuffer(typeaheadRef.current, now);
      if (!isTypeaheadKey(event, buffer)) return;
      typeaheadRef.current = advanceTypeahead(typeaheadRef.current, event.key, now);
      moveTo(findTypeaheadIndex(items, typeaheadRef.current.buffer, moveFrom(now)), now);
    }
    event.preventDefault();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (items.length < 2) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPosition: Math.max(selectedIndex, 0),
      itemPx: event.currentTarget.getBoundingClientRect().height / wheelVisibleRows,
      moved: false,
      position: Math.max(selectedIndex, 0),
    };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const travel = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(travel) < wheelDragThresholdPx) return;
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.position = Math.min(
      items.length - 1,
      Math.max(0, drag.startPosition - travel / drag.itemPx),
    );
    setDragPosition(drag.position);
  };
  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved) return;
    suppressClickRef.current = true;
    setDragPosition(null);
    if (event.type === "pointercancel") return;
    const direction = drag.position >= drag.startPosition ? 1 : -1;
    const target = nearestEnabledIndex(items, Math.round(drag.position), direction);
    if (target >= 0) moveTo(target, event.timeStamp);
  };

  return (
    <div
      ref={attachWheel}
      className={cn("group/wheel relative flex min-w-0 flex-col", className)}
      data-wheel-column={label}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-(--wheel-head) bottom-0 z-0 overflow-hidden rounded-xl border border-foreground/8 bg-foreground/[0.035] group-has-[:focus-visible]/wheel:border-ring/70"
      >
        <div className="absolute inset-0 bg-linear-to-b from-black/10 via-transparent to-black/10 dark:from-black/30 dark:to-black/30" />
      </div>
      <div className="relative z-20 flex h-(--wheel-head) items-center justify-center px-2">
        {headerSlot ?? (
          <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        )}
      </div>
      <div
        role="listbox"
        ref={listboxRef}
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
        data-dragging={dragging ? "true" : undefined}
        className={cn(
          "wheel-fade relative z-20 h-[calc(var(--wheel-item)*5)] touch-none select-none overflow-hidden rounded-lg outline-none [perspective:36rem]",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 top-[calc(50%-var(--wheel-item)/2)] z-0 hidden h-(--wheel-item) rounded-xl border border-brand/70 bg-linear-to-b from-brand/60 to-brand/40 @max-[31rem]/picker:block"
        />
        {items.slice(range.start, range.end).map((item, offset) => {
          const index = range.start + offset;
          const pose = wheelPose(index - position);
          const isCentered = index === center;
          const disabled = item.disabled === true;
          const option = (
            <div
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              aria-disabled={disabled || undefined}
              aria-posinset={index + 1}
              aria-setsize={items.length}
              data-selected={isCentered ? "true" : undefined}
              className={cn(
                "group/option absolute inset-x-1 top-[calc(50%-var(--wheel-item)/2)] z-10 flex h-(--wheel-item) items-center justify-center gap-2 rounded-lg px-2 transition-[transform,opacity] duration-180 ease-out motion-reduce:transition-none",
                dragging && "transition-none",
                !pose.interactive && "pointer-events-none",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
                !isCentered && !disabled && "hover:bg-row-hover",
                isCentered
                  ? "font-semibold text-foreground dark:text-white"
                  : "text-foreground/80 hover:text-foreground",
              )}
              style={{
                transform: wheelPoseTransform(pose),
                opacity: item.muted ? pose.opacity * mutedOpacity : pose.opacity,
              }}
              onClick={(event) => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                moveTo(index, event.timeStamp, event.shiftKey);
              }}
              onDoubleClick={() => {
                if (!disabled) onActivate?.(index);
              }}
            >
              {item.icon ? <span className="flex shrink-0 items-center">{item.icon}</span> : null}
              <span className="min-w-0 text-center">
                <span
                  className={cn(
                    "block truncate leading-tight",
                    isCentered ? "text-base" : "text-sm",
                  )}
                >
                  {item.label}
                </span>
                {item.sublabel ? (
                  <span
                    className={cn(
                      "block truncate text-xs leading-tight",
                      isCentered
                        ? "font-normal text-foreground/75 dark:text-white/75"
                        : "text-muted-foreground",
                    )}
                  >
                    {item.sublabel}
                  </span>
                ) : null}
              </span>
              {item.trailing ? (
                <span className="flex shrink-0 items-center">{item.trailing}</span>
              ) : null}
            </div>
          );
          return item.title ? (
            <Tooltip key={item.id}>
              <TooltipTrigger render={option} />
              <TooltipPopup side="top">{item.title}</TooltipPopup>
            </Tooltip>
          ) : (
            option
          );
        })}
      </div>
      {headerAction ? (
        <div className="absolute end-1 top-0 z-30 flex h-7 items-center">{headerAction}</div>
      ) : null}
    </div>
  );
}
