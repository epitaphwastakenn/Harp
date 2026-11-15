import {
  AmbientLight,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  ShapeGeometry,
  Texture,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { observeResize } from "~/lib/observeResize";

import { framingDistance, planGrid } from "./modelFraming";

const fovDegrees = 40;
const timeEmitIntervalMs = 66;
const cameraDirection = new Vector3(0.55, 0.45, -1).normalize();

export interface ModelClip {
  readonly name: string;
  readonly duration: number;
}

export interface ModelSceneHooks {
  readonly onTime: (time: number) => void;
  readonly onPlayingChange: (playing: boolean) => void;
  readonly onContextLost: () => void;
}

export interface ModelScene {
  readonly clips: ReadonlyArray<ModelClip>;
  readonly measuredSize: readonly [number, number, number];
  readonly measuredTriangles: number;
  readonly gridStudsPerCell: number;
  resetView: () => void;
  selectClip: (index: number) => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setLoop: (loop: boolean) => void;
  dispose: () => void;
}

let activeScene: ModelScene | null = null;

function disposeMaterial(material: Material) {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

function disposeMeshes(root: Object3D) {
  root.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof GridHelper)) return;
    (object.geometry as BufferGeometry).dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) disposeMaterial(material as Material);
  });
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(0,0,0,0.6)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.25)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

function countTriangles(root: Object3D) {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    const count = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    triangles += Math.floor(count / 3);
  });
  return triangles;
}

function parseGlb(buffer: ArrayBuffer) {
  return new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", resolve, (error) =>
      reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

/** Parses the GLB into a scene drawn on demand; only one scene lives at a time. */
export async function createModelScene(
  host: HTMLElement,
  buffer: ArrayBuffer,
  hooks: ModelSceneHooks,
  signal?: AbortSignal,
): Promise<ModelScene> {
  const gltf = await parseGlb(buffer).catch(() => {
    throw new Error("The model file could not be read.");
  });
  if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
  activeScene?.dispose();

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    throw new Error("WebGL is not available.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";

  const scene = new Scene();
  const root = gltf.scene;
  scene.add(root);
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    renderer.dispose();
    renderer.forceContextLoss();
    disposeMeshes(root);
    throw new Error("The model has no geometry.");
  }
  host.appendChild(canvas);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(size.length() / 2, 0.01);
  const footprint = Math.max(size.x, size.z);

  const pmrem = new PMREMGenerator(renderer);
  const environment = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(environment, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.7;
  scene.add(new AmbientLight(0xffffff, 0.35));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(center.x - radius * 2, center.y + radius * 3, center.z - radius * 2);
  scene.add(key);

  const grid = planGrid(footprint);
  const gridHelper = new GridHelper(grid.sizeMetres, grid.divisions, 0x6b6b78, 0x3d3d48);
  gridHelper.position.set(center.x, bounds.min.y, center.z);
  scene.add(gridHelper);

  const shadowMap = shadowTexture();
  const shadowSize = Math.max(footprint, 0.05) * 1.7;
  const shadow = new Mesh(
    new PlaneGeometry(shadowSize, shadowSize),
    new MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(center.x, bounds.min.y, center.z);
  shadow.renderOrder = 1;
  scene.add(shadow);

  const arrowSize = Math.max(footprint, 0.05) * 0.18;
  const arrowShape = new Shape();
  arrowShape.moveTo(0, arrowSize);
  arrowShape.lineTo(arrowSize * 0.75, -arrowSize * 0.5);
  arrowShape.lineTo(0, -arrowSize * 0.2);
  arrowShape.lineTo(-arrowSize * 0.75, -arrowSize * 0.5);
  arrowShape.closePath();
  const marker = new Mesh(
    new ShapeGeometry(arrowShape),
    new MeshBasicMaterial({ color: new Color(0xf59e0b), side: DoubleSide }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.set(center.x, bounds.min.y + footprint * 0.001, bounds.min.z - arrowSize * 1.6);
  scene.add(marker);

  const camera = new PerspectiveCamera(fovDegrees, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.listenToKeyEvents(host);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;

  const mixer = new AnimationMixer(root);
  const clips = gltf.animations.map((clip) => ({ name: clip.name, duration: clip.duration }));
  let action: AnimationAction | null = null;
  let loop = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = false;
  let frameId = 0;
  let renderQueued = false;
  let lastFrameAt = 0;
  let lastEmitAt = 0;
  let disposed = false;

  const renderNow = () => {
    controls.update();
    renderer.render(scene, camera);
  };

  const requestRender = () => {
    if (renderQueued || playing || disposed) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!disposed) renderNow();
    });
  };

  const placeCamera = () => {
    const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    const distance = framingDistance(radius, fovDegrees, aspect);
    camera.position.copy(center).addScaledVector(cameraDirection, distance);
    camera.near = distance / 200;
    camera.far = distance * 200;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.minDistance = radius * 0.2;
    controls.maxDistance = distance * 8;
    controls.update();
  };

  const resize = () => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  };

  const emitTime = () => hooks.onTime(action?.time ?? 0);

  const frame = (now: number) => {
    frameId = 0;
    if (!playing || disposed) return;
    mixer.update(Math.min((now - lastFrameAt) / 1000, 0.1));
    lastFrameAt = now;
    renderNow();
    if (now - lastEmitAt >= timeEmitIntervalMs) {
      lastEmitAt = now;
      emitTime();
    }
    if (playing) frameId = requestAnimationFrame(frame);
  };

  const setPlaying = (next: boolean) => {
    if (playing === next) return;
    playing = next;
    hooks.onPlayingChange(next);
    if (next) {
      lastFrameAt = performance.now();
      frameId = requestAnimationFrame(frame);
      return;
    }
    if (frameId !== 0) cancelAnimationFrame(frameId);
    frameId = 0;
    emitTime();
    requestRender();
  };

  mixer.addEventListener("finished", () => setPlaying(false));

  const startClip = (index: number) => {
    mixer.stopAllAction();
    const clip = gltf.animations[index];
    if (clip === undefined) return;
    action = mixer.clipAction(clip);
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.reset().play();
    mixer.setTime(0);
    emitTime();
    requestRender();
  };

  const stopObservingResize = observeResize(host, resize);
  controls.addEventListener("change", requestRender);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    hooks.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  const handle: ModelScene = {
    clips,
    measuredSize: [size.x, size.z, size.y],
    measuredTriangles: countTriangles(root),
    gridStudsPerCell: grid.studsPerCell,
    resetView: () => {
      placeCamera();
      requestRender();
    },
    selectClip: (index) => {
      setPlaying(false);
      startClip(index);
    },
    play: () => {
      if (action === null || playing) return;
      if (!loop && action.time >= action.getClip().duration - 1e-4) {
        action.reset().play();
        mixer.setTime(0);
      }
      action.paused = false;
      action.enabled = true;
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    seek: (time) => {
      if (action === null) return;
      action.paused = false;
      action.enabled = true;
      if (!action.isRunning()) action.play();
      mixer.setTime(Math.max(0, Math.min(time, action.getClip().duration)));
      emitTime();
      requestRender();
    },
    setLoop: (next) => {
      loop = next;
      if (action === null) return;
      action.setLoop(next ? LoopRepeat : LoopOnce, Infinity);
      action.clampWhenFinished = true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (activeScene === handle) activeScene = null;
      if (frameId !== 0) cancelAnimationFrame(frameId);
      stopObservingResize();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      controls.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      disposeMeshes(scene);
      disposeMeshes(environment);
      shadowMap.dispose();
      environmentTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };

  activeScene = handle;
  resize();
  placeCamera();
  if (clips.length > 0) startClip(0);
  renderNow();
  return handle;
}
