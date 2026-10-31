import { useId } from "react";

import { buildVoxelScene, sealIceFloeVoxels } from "./sealIceFloeVoxels";
import "./SealIceFloeScene.css";

const scene = buildVoxelScene(sealIceFloeVoxels());
const padding = 12;

export function SealIceFloeScene(props: { className?: string }) {
  const glowId = `seal-glow-${useId().replace(/[^\w-]/g, "")}`;
  const { x, y, width, height } = scene.viewBox;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-seal-scene=""
      className={props.className}
      viewBox={`${x - padding} ${y - padding} ${width + padding * 2} ${height + padding * 2}`}
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" data-glow="" stopOpacity={0.45} />
          <stop offset="1" data-glow="" stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse
        cx={x + width / 2}
        cy={y + height * 0.8}
        rx={width * 0.6}
        ry={height * 0.3}
        fill={`url(#${glowId})`}
      />
      {scene.paths.map((path) => (
        <path
          key={`${path.level}-${path.material}-${path.face}`}
          data-material={path.material}
          data-face={path.face}
          d={path.d}
        />
      ))}
    </svg>
  );
}
