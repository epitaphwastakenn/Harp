import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PauseIcon, PlayIcon, RepeatIcon, RotateCcwIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ModelPreviewReference } from "@t3tools/shared/toolOutput";

import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { fetchModelPreviewGlb } from "./modelPreviewFetch";
import { formatMetreSize, formatStudSize, metresPerStud } from "./modelPreviewVersions";
import { createModelScene, type ModelScene } from "./modelScene";

interface ModelViewerProps {
  readonly environmentId: EnvironmentId;
  readonly preview: ModelPreviewReference;
  readonly onUnavailable: (reason: string) => void;
}

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

function ClipControls({
  scene,
  playing,
  time,
  loop,
  clipIndex,
  onClipChange,
  onLoopChange,
}: {
  readonly scene: ModelScene;
  readonly playing: boolean;
  readonly time: number;
  readonly loop: boolean;
  readonly clipIndex: number;
  readonly onClipChange: (index: number) => void;
  readonly onLoopChange: (loop: boolean) => void;
}) {
  const clip = scene.clips[clipIndex];
  if (clip === undefined) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-white/80">
      <Button
        type="button"
        size="icon-xs"
        variant="overlay"
        aria-label={playing ? "Pause animation" : "Play animation"}
        onClick={() => (playing ? scene.pause() : scene.play())}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>
      <input
        type="range"
        aria-label="Animation time"
        className="min-w-0 flex-1 accent-white"
        min={0}
        max={clip.duration}
        step={clip.duration / 200 || 0.01}
        value={Math.min(time, clip.duration)}
        onChange={(event) => scene.seek(Number(event.currentTarget.value))}
      />
      <span className="shrink-0 tabular-nums">
        {formatTime(time)} / {formatTime(clip.duration)}
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant={loop ? "secondary" : "overlay"}
        aria-label="Loop animation"
        aria-pressed={loop}
        onClick={() => onLoopChange(!loop)}
      >
        <RepeatIcon />
      </Button>
      {scene.clips.length > 1 ? (
        <select
          aria-label="Animation clip"
          className="max-w-32 shrink-0 truncate rounded-md bg-black/70 px-1.5 py-1 text-xs text-white/90 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          value={clipIndex}
          onChange={(event) => onClipChange(Number(event.currentTarget.value))}
        >
          {scene.clips.map((entry, index) => (
            <option key={`${String(index)}:${entry.name}`} value={index}>
              {entry.name || `Clip ${index + 1}`}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export default function ModelViewer({ environmentId, preview, onUnavailable }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<ModelScene | null>(null);
  const [clipIndex, setClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [loop, setLoop] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reportUnavailable = useEffectEvent(onUnavailable);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the WebGL context, which must be created after fetching the GLB and released on close
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const controller = new AbortController();
    let created: ModelScene | null = null;
    void (async () => {
      const buffer = await fetchModelPreviewGlb(
        environmentId,
        preview.previewId,
        controller.signal,
      );
      const next = await createModelScene(host, buffer, {
        onTime: setTime,
        onPlayingChange: setPlaying,
        onContextLost: () => reportUnavailable("The graphics context was lost."),
      });
      if (controller.signal.aborted) {
        next.dispose();
        return;
      }
      created = next;
      setScene(next);
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      reportUnavailable(cause instanceof Error ? cause.message : "The 3D view could not start.");
    });
    return () => {
      controller.abort();
      created?.dispose();
    };
  }, [environmentId, preview.previewId]);

  const dimensions = preview.dimensions.some((value) => value > 0)
    ? preview.dimensions
    : (scene?.measuredSize ?? preview.dimensions);

  return (
    <div
      data-model-viewer
      className="relative size-full overflow-hidden rounded-lg border border-border/70 bg-black shadow-2xl"
    >
      <div ref={hostRef} className="absolute inset-0" />
      {scene === null ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-5rem)] rounded-md bg-black/70 px-2 py-1 text-xs leading-4 text-white/85">
            <div className="tabular-nums">
              {preview.triangles.toLocaleString()} triangles · {formatStudSize(dimensions)} studs
            </div>
            <div className="text-white/60 tabular-nums">
              {formatMetreSize(dimensions)} m · 1 stud = {metresPerStud} m · grid{" "}
              {scene.gridStudsPerCell} stud{scene.gridStudsPerCell === 1 ? "" : "s"} · orange arrow
              marks front (-Z)
            </div>
          </div>
          <div className="absolute right-2 top-2">
            <Button
              type="button"
              size="icon-xs"
              variant="overlay"
              aria-label="Reset view"
              title="Reset view"
              onClick={() => scene.resetView()}
            >
              <RotateCcwIcon />
            </Button>
          </div>
          {scene.clips.length > 0 ? (
            <div className="absolute inset-x-2 bottom-2 rounded-md bg-black/60 p-1.5">
              <ClipControls
                scene={scene}
                playing={playing}
                time={time}
                loop={loop}
                clipIndex={clipIndex}
                onClipChange={(index) => {
                  setClipIndex(index);
                  scene.selectClip(index);
                }}
                onLoopChange={(next) => {
                  setLoop(next);
                  scene.setLoop(next);
                }}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
