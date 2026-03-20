import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import JSZip from "jszip";

const canvas = document.getElementById("viewerCanvas");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const viewerWrap = document.querySelector(".viewer-wrap");
const viewToolbar = document.getElementById("viewToolbar");
const modelInfo = document.getElementById("modelInfo");
const renderSolidBtn = document.getElementById("renderSolid");
const renderWireBtn = document.getElementById("renderWire");
const detectBoundaryBtn = document.getElementById("detectBoundaryBtn");
const enterSlicePreviewBtn = document.getElementById("enterSlicePreviewBtn");
const slicePreviewOverlay = document.getElementById("slicePreviewOverlay");
const slicePreviewCanvas = document.getElementById("slicePreviewCanvas");
const sliceEngine = document.getElementById("sliceEngine");
const previewZSlider = document.getElementById("previewZSlider");
const previewZValue = document.getElementById("previewZValue");
const previewPerfText = document.getElementById("previewPerfText");
const previewBackBtn = document.getElementById("previewBackBtn");
const previewExportBtn = document.getElementById("previewExportBtn");
const sectionSlider = document.getElementById("sectionSlider");
const sectionStep = document.getElementById("sectionStep");
const sectionValue = document.getElementById("sectionValue");
const sectionFillToggle = document.getElementById("sectionFillToggle");
const sectionFillColor = document.getElementById("sectionFillColor");
const boundarySensitivity = document.getElementById("boundarySensitivity");
const boundarySensitivityValue = document.getElementById("boundarySensitivityValue");
const platformWidthInput = document.getElementById("platformWidth");
const platformHeightInput = document.getElementById("platformHeight");
const exportWidthInput = document.getElementById("exportWidth");
const exportHeightInput = document.getElementById("exportHeight");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe5e7eb);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(0, 0, 150);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
renderer.localClippingEnabled = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enableRotate = false;
controls.screenSpacePanning = true;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: null,
};

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(80, 100, 120);
scene.add(dirLight);

let platformGrid = null;

function buildPlatformGrid(width, height, xDivisions = 16, yDivisions = 12) {
  if (platformGrid) {
    scene.remove(platformGrid);
    platformGrid.geometry?.dispose();
    platformGrid.material?.dispose();
    platformGrid = null;
  }

  const halfW = width / 2;
  const halfH = height / 2;
  const points = [];

  for (let i = 0; i <= xDivisions; i += 1) {
    const x = -halfW + (width * i) / xDivisions;
    points.push(x, -halfH, 0, x, halfH, 0);
  }

  for (let j = 0; j <= yDivisions; j += 1) {
    const y = -halfH + (height * j) / yDivisions;
    points.push(-halfW, y, 0, halfW, y, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.85 });

  platformGrid = new THREE.LineSegments(geometry, material);
  platformGrid.position.set(0, 0, 0);
  scene.add(platformGrid);
}

function updatePlatformGridFromInputs() {
  const width = Math.max(1, Number(platformWidthInput.value) || 192);
  const height = Math.max(1, Number(platformHeightInput.value) || 120);
  buildPlatformGrid(width, height);
}

updatePlatformGridFromInputs();

const axis = new THREE.AxesHelper(80);
scene.add(axis);

const modelItems = [];
let activeModelId = null;
let dragCounter = 0;
let renderMode = "solid";
let sectionHeight = 0;
let isRightDragging = false;
let rightDragPointerId = null;
let isSlicePreviewMode = false;
let previewRequestToken = 0;
let previewSliceCache = null;
let previewSliceBounds = null;
let previewSliceModelSetKey = "";
const modelSliceCacheMap = new Map();
const gpuSliceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
const gpuSliceMaterial = new THREE.ShaderMaterial({
  uniforms: {
    zMin: { value: 0 },
    zMax: { value: 0 },
  },
  vertexShader: `
    varying float vWorldZ;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldZ = worldPos.z;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  fragmentShader: `
    varying float vWorldZ;
    uniform float zMin;
    uniform float zMax;
    void main() {
      if (vWorldZ < zMin || vWorldZ > zMax) {
        discard;
      }
      gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    }
  `,
  side: THREE.DoubleSide,
  depthTest: true,
  depthWrite: true,
});
let gpuSliceRenderTarget = null;
let gpuSlicePixels = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const lastPointer = new THREE.Vector2();
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const worldUp = new THREE.Vector3(0, 0, 1);
const tempDirection = new THREE.Vector3();
const tempRightAxis = new THREE.Vector3();
const tempUpAxis = new THREE.Vector3();
const exteriorFaceColor = new THREE.Color(0x3b82f6);
const interiorFaceColor = new THREE.Color(0xf59e0b);

const sectionLineMaterial = new LineMaterial({
  color: 0xff2d2d,
  linewidth: 5,
  transparent: true,
  opacity: 1,
  depthTest: true,
});
const sectionLineGroup = new THREE.Group();
sectionLineGroup.visible = false;
scene.add(sectionLineGroup);

const boundaryLineMaterial = new LineMaterial({
  color: 0xff0033,
  linewidth: 6,
  transparent: true,
  opacity: 1,
  depthTest: true,
});
const boundaryLineGroup = new THREE.Group();
boundaryLineGroup.visible = false;
scene.add(boundaryLineGroup);

const sectionFrameMaterial = new THREE.LineBasicMaterial({
  color: sectionFillColor.value,
  transparent: true,
  opacity: 0.95,
});
const sectionFrameGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.5, -0.5, 0),
  new THREE.Vector3(0.5, -0.5, 0),
  new THREE.Vector3(0.5, 0.5, 0),
  new THREE.Vector3(-0.5, 0.5, 0),
  new THREE.Vector3(-0.5, -0.5, 0),
]);
const sectionFrameLine = new THREE.Line(sectionFrameGeometry, sectionFrameMaterial);
sectionFrameLine.visible = false;
sectionFrameLine.renderOrder = 3;
scene.add(sectionFrameLine);

let sliceWorker = null;
let sliceWorkerReady = false;
let sliceWorkerRequestId = 1;
const sliceWorkerPending = new Map();

function ensureSliceWorker() {
  if (sliceWorker) {
    return;
  }

  sliceWorker = new Worker(new URL("./workers/sliceWorker.js", import.meta.url), { type: "module" });
  sliceWorker.onmessage = (event) => {
    const data = event.data;

    if (data.type === "inited") {
      sliceWorkerReady = true;
      return;
    }

    if (data.type === "sliceResult") {
      const pending = sliceWorkerPending.get(data.requestId);
      if (!pending) {
        return;
      }
      sliceWorkerPending.delete(data.requestId);
      pending.resolve(new Float32Array(data.segmentsBuffer));
      return;
    }
  };

  sliceWorker.onerror = (error) => {
    sliceWorkerPending.forEach((pending) => pending.reject(error));
    sliceWorkerPending.clear();
    sliceWorkerReady = false;
  };
}

async function initSliceWorkerWithCache(sliceCache) {
  ensureSliceWorker();

  const initPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("slice worker init timeout"));
    }, 15000);

    const onReady = () => {
      if (!sliceWorkerReady) {
        requestAnimationFrame(onReady);
        return;
      }
      clearTimeout(timeout);
      resolve();
    };

    onReady();
  });

  sliceWorkerReady = false;
  sliceWorker.postMessage({
    type: "init",
    trianglesBuffer: sliceCache.triangles.buffer,
    triMinZBuffer: sliceCache.triMinZ.buffer,
    triMaxZBuffer: sliceCache.triMaxZ.buffer,
    triCount: sliceCache.triCount,
  });

  await initPromise;
}

function computeSliceSegmentsWithWorker(z) {
  return new Promise((resolve, reject) => {
    if (!sliceWorker || !sliceWorkerReady) {
      reject(new Error("slice worker not ready"));
      return;
    }

    const requestId = sliceWorkerRequestId++;
    sliceWorkerPending.set(requestId, { resolve, reject });
    sliceWorker.postMessage({ type: "slice", requestId, z });
  });
}

function buildSliceTriangleCache(object3D) {
  const triangles = [];
  const triMinZ = [];
  const triMaxZ = [];

  object3D.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    const geometry = child.geometry;
    const position = geometry.getAttribute("position");
    if (!position) {
      return;
    }

    const index = geometry.getIndex();
    child.updateWorldMatrix(true, false);
    const readIndex = (idx) => (index ? index.getX(idx) : idx);
    const triCount = index ? index.count / 3 : Math.floor(position.count / 3);

    for (let tri = 0; tri < triCount; tri += 1) {
      const ia = readIndex(tri * 3);
      const ib = readIndex(tri * 3 + 1);
      const ic = readIndex(tri * 3 + 2);

      const a = new THREE.Vector3(position.getX(ia), position.getY(ia), position.getZ(ia)).applyMatrix4(
        child.matrixWorld,
      );
      const b = new THREE.Vector3(position.getX(ib), position.getY(ib), position.getZ(ib)).applyMatrix4(
        child.matrixWorld,
      );
      const c = new THREE.Vector3(position.getX(ic), position.getY(ic), position.getZ(ic)).applyMatrix4(
        child.matrixWorld,
      );

      triangles.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      triMinZ.push(Math.min(a.z, b.z, c.z));
      triMaxZ.push(Math.max(a.z, b.z, c.z));
    }
  });

  return {
    triangles: new Float32Array(triangles),
    triMinZ: new Float32Array(triMinZ),
    triMaxZ: new Float32Array(triMaxZ),
    triCount: triMinZ.length,
  };
}

function getCurrentModelSetKey() {
  return modelItems.map((item) => item.id).join("|");
}

function getOrBuildModelSliceCache(modelItem) {
  let cache = modelSliceCacheMap.get(modelItem.id);
  if (!cache) {
    cache = buildSliceTriangleCache(modelItem.object3D);
    modelSliceCacheMap.set(modelItem.id, cache);
  }
  return cache;
}

function mergeSliceCaches(caches) {
  const validCaches = caches.filter((cache) => cache && cache.triCount > 0);
  if (!validCaches.length) {
    return {
      triangles: new Float32Array(0),
      triMinZ: new Float32Array(0),
      triMaxZ: new Float32Array(0),
      triCount: 0,
    };
  }

  let totalTriCount = 0;
  validCaches.forEach((cache) => {
    totalTriCount += cache.triCount;
  });

  const triangles = new Float32Array(totalTriCount * 9);
  const triMinZ = new Float32Array(totalTriCount);
  const triMaxZ = new Float32Array(totalTriCount);

  let triOffset = 0;
  validCaches.forEach((cache) => {
    triangles.set(cache.triangles, triOffset * 9);
    triMinZ.set(cache.triMinZ, triOffset);
    triMaxZ.set(cache.triMaxZ, triOffset);
    triOffset += cache.triCount;
  });

  return {
    triangles,
    triMinZ,
    triMaxZ,
    triCount: totalTriCount,
  };
}

function buildSceneSliceCache() {
  const caches = modelItems.map((item) => getOrBuildModelSliceCache(item));
  return mergeSliceCaches(caches);
}

function dedupeSegmentPoints(segmentPoints, precision = 1000) {
  if (!segmentPoints.length) {
    return new Float32Array(0);
  }

  const counts = new Map();
  const keyOfPoint = (x, y) => `${Math.round(x * precision)}_${Math.round(y * precision)}`;

  for (let i = 0; i < segmentPoints.length; i += 4) {
    const x1 = segmentPoints[i];
    const y1 = segmentPoints[i + 1];
    const x2 = segmentPoints[i + 2];
    const y2 = segmentPoints[i + 3];
    const p1 = keyOfPoint(x1, y1);
    const p2 = keyOfPoint(x2, y2);
    const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const deduped = [];
  for (let i = 0; i < segmentPoints.length; i += 4) {
    const x1 = segmentPoints[i];
    const y1 = segmentPoints[i + 1];
    const x2 = segmentPoints[i + 2];
    const y2 = segmentPoints[i + 3];
    const p1 = keyOfPoint(x1, y1);
    const p2 = keyOfPoint(x2, y2);
    const key = p1 < p2 ? `${p1}|${p2}` : `${p2}|${p1}`;
    const count = counts.get(key) || 0;
    if (count % 2 === 1) {
      deduped.push(x1, y1, x2, y2);
      counts.set(key, 0);
    }
  }

  return new Float32Array(deduped);
}

function intersectEdgeAtZ(x1, y1, z1, x2, y2, z2, z0, outHits) {
  const d1 = z1 - z0;
  const d2 = z2 - z0;

  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) {
    return;
  }

  if (Math.abs(d1 - d2) < 1e-8) {
    return;
  }

  const t = d1 / (d1 - d2);
  if (t < 0 || t > 1) {
    return;
  }

  outHits.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
}

function computeSectionSegmentsAtZ(sliceCache, z0) {
  const segmentPoints = [];
  const { triangles, triMinZ, triMaxZ, triCount } = sliceCache;

  for (let tri = 0; tri < triCount; tri += 1) {
    if (z0 < triMinZ[tri] || z0 > triMaxZ[tri]) {
      continue;
    }

    const base = tri * 9;
    const ax = triangles[base];
    const ay = triangles[base + 1];
    const az = triangles[base + 2];
    const bx = triangles[base + 3];
    const by = triangles[base + 4];
    const bz = triangles[base + 5];
    const cx = triangles[base + 6];
    const cy = triangles[base + 7];
    const cz = triangles[base + 8];

    const hits = [];
    intersectEdgeAtZ(ax, ay, az, bx, by, bz, z0, hits);
    intersectEdgeAtZ(bx, by, bz, cx, cy, cz, z0, hits);
    intersectEdgeAtZ(cx, cy, cz, ax, ay, az, z0, hits);

    if (hits.length >= 4) {
      segmentPoints.push(hits[0], hits[1], hits[2], hits[3]);
    }
  }

  return segmentPoints;
}

function fillSegmentsByScanline(ctx, pixelSegments, width, height) {
  if (!pixelSegments.length) {
    return;
  }

  const epsilon = 1e-6;

  for (let y = 0; y < height; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];

    for (let i = 0; i < pixelSegments.length; i += 4) {
      const x1 = pixelSegments[i];
      const y1 = pixelSegments[i + 1];
      const x2 = pixelSegments[i + 2];
      const y2 = pixelSegments[i + 3];

      const dy = y2 - y1;
      if (Math.abs(dy) < epsilon) {
        continue;
      }

      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      if (scanY < minY || scanY >= maxY) {
        continue;
      }

      const t = (scanY - y1) / dy;
      intersections.push(x1 + (x2 - x1) * t);
    }

    if (intersections.length < 2) {
      continue;
    }

    intersections.sort((a, b) => a - b);

    ctx.beginPath();
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = Math.max(0, Math.min(width, intersections[i]));
      const xEnd = Math.max(0, Math.min(width, intersections[i + 1]));
      const segmentWidth = xEnd - xStart;

      if (segmentWidth > 0.25) {
        ctx.rect(xStart, y, segmentWidth, 1);
      }
    }
    ctx.fill();
  }
}

function ensureGpuSliceRenderResources(width, height) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  if (!gpuSliceRenderTarget || gpuSliceRenderTarget.width !== w || gpuSliceRenderTarget.height !== h) {
    gpuSliceRenderTarget?.dispose();
    gpuSliceRenderTarget = new THREE.WebGLRenderTarget(w, h, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    gpuSlicePixels = new Uint8Array(w * h * 4);
  }
}

function drawSliceLabel(ctx, zValue, sizeH) {
  ctx.fillStyle = "#ffffff";
  ctx.font = `${Math.max(18, Math.round(sizeH * 0.02))}px Segoe UI`;
  ctx.fillText(`Z = ${zValue.toFixed(2)}`, 20, Math.max(30, Math.round(sizeH * 0.03)));
}

function drawSliceOnCanvasCPU(targetCanvas, segmentPoints, zValue, renderSettings) {
  const { outputWidth, outputHeight, platformWidth, platformHeight, centerX, centerY } = renderSettings;
  const sizeW = outputWidth;
  const sizeH = outputHeight;
  targetCanvas.width = sizeW;
  targetCanvas.height = sizeH;
  const ctx = targetCanvas.getContext("2d");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, sizeW, sizeH);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;

  const left = centerX - platformWidth / 2;
  const bottom = centerY - platformHeight / 2;
  const uniformScale = Math.min(sizeW / platformWidth, sizeH / platformHeight);
  const contentW = platformWidth * uniformScale;
  const contentH = platformHeight * uniformScale;
  const marginX = (sizeW - contentW) / 2;
  const marginY = (sizeH - contentH) / 2;

  const toPixelX = (x) => marginX + (x - left) * uniformScale;
  const toPixelY = (y) => sizeH - (marginY + (y - bottom) * uniformScale);

  const pixelSegments = [];
  for (let i = 0; i < segmentPoints.length; i += 4) {
    pixelSegments.push(
      toPixelX(segmentPoints[i]),
      toPixelY(segmentPoints[i + 1]),
      toPixelX(segmentPoints[i + 2]),
      toPixelY(segmentPoints[i + 3]),
    );
  }

  ctx.fillStyle = "#ffffff";
  fillSegmentsByScanline(ctx, pixelSegments, sizeW, sizeH);

  for (let i = 0; i < pixelSegments.length; i += 4) {
    const x1 = pixelSegments[i];
    const y1 = pixelSegments[i + 1];
    const x2 = pixelSegments[i + 2];
    const y2 = pixelSegments[i + 3];

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  drawSliceLabel(ctx, zValue, sizeH);
}

function drawSliceOnCanvasGPU(targetCanvas, zValue, renderSettings) {
  const { outputWidth, outputHeight, platformWidth, platformHeight, centerX, centerY } = renderSettings;
  const sizeW = Math.max(1, Math.floor(outputWidth));
  const sizeH = Math.max(1, Math.floor(outputHeight));

  targetCanvas.width = sizeW;
  targetCanvas.height = sizeH;
  ensureGpuSliceRenderResources(sizeW, sizeH);

  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = renderer.getClearAlpha();
  const previousOverride = scene.overrideMaterial;

  const helperObjects = [axis, sectionLineGroup, boundaryLineGroup, sectionFrameLine, platformGrid].filter(Boolean);
  const helperVisibility = helperObjects.map((obj) => obj.visible);

  helperObjects.forEach((obj) => {
    obj.visible = false;
  });

  const halfThickness = Math.max(0.02, (Math.max(0.01, Number(sectionStep.value) || 1) * 0.5) / 2);
  gpuSliceMaterial.uniforms.zMin.value = zValue - halfThickness;
  gpuSliceMaterial.uniforms.zMax.value = zValue + halfThickness;

  const halfW = platformWidth / 2;
  const halfH = platformHeight / 2;
  gpuSliceCamera.left = -halfW;
  gpuSliceCamera.right = halfW;
  gpuSliceCamera.top = halfH;
  gpuSliceCamera.bottom = -halfH;
  gpuSliceCamera.near = 0.1;
  gpuSliceCamera.far = 20000;
  gpuSliceCamera.position.set(centerX, centerY, 10000);
  gpuSliceCamera.up.set(0, 1, 0);
  gpuSliceCamera.lookAt(centerX, centerY, 0);
  gpuSliceCamera.updateProjectionMatrix();

  renderer.setRenderTarget(gpuSliceRenderTarget);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);
  scene.overrideMaterial = gpuSliceMaterial;
  renderer.render(scene, gpuSliceCamera);
  renderer.readRenderTargetPixels(gpuSliceRenderTarget, 0, 0, sizeW, sizeH, gpuSlicePixels);

  scene.overrideMaterial = previousOverride;
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousClearColor, previousClearAlpha);

  helperObjects.forEach((obj, idx) => {
    obj.visible = helperVisibility[idx];
  });

  const ctx = targetCanvas.getContext("2d");
  const imageData = ctx.createImageData(sizeW, sizeH);
  const edgeMask = new Uint8Array(sizeW * sizeH);
  const threshold = 24;

  for (let y = 0; y < sizeH; y += 1) {
    const srcY = sizeH - 1 - y;
    for (let x = 0; x < sizeW; x += 1) {
      const srcIdx = (srcY * sizeW + x) * 4;
      const luminance = gpuSlicePixels[srcIdx] + gpuSlicePixels[srcIdx + 1] + gpuSlicePixels[srcIdx + 2];
      edgeMask[y * sizeW + x] = luminance > threshold ? 1 : 0;
    }
  }

  for (let y = 0; y < sizeH; y += 1) {
    const rowOffset = y * sizeW;
    const intersections = [];
    let prev = 0;

    for (let x = 0; x < sizeW; x += 1) {
      imageData.data[(rowOffset + x) * 4 + 3] = 255;
    }

    for (let x = 0; x < sizeW; x += 1) {
      const current = edgeMask[rowOffset + x];
      if (current && !prev) {
        intersections.push(x);
      }
      prev = current;
    }

    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const xStart = intersections[i];
      const xEnd = intersections[i + 1];
      for (let x = xStart; x <= xEnd; x += 1) {
        const dstIdx = (rowOffset + x) * 4;
        imageData.data[dstIdx] = 255;
        imageData.data[dstIdx + 1] = 255;
        imageData.data[dstIdx + 2] = 255;
        imageData.data[dstIdx + 3] = 255;
      }
    }

    for (let x = 0; x < sizeW; x += 1) {
      if (edgeMask[rowOffset + x]) {
        const dstIdx = (rowOffset + x) * 4;
        imageData.data[dstIdx] = 255;
        imageData.data[dstIdx + 1] = 255;
        imageData.data[dstIdx + 2] = 255;
        imageData.data[dstIdx + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  drawSliceLabel(ctx, zValue, sizeH);
}

async function drawSliceOnCanvas(targetCanvas, segmentPoints, zValue, renderSettings) {
  if ((renderSettings.sliceEngine || "cpu") === "gpu") {
    drawSliceOnCanvasGPU(targetCanvas, zValue, renderSettings);
    return;
  }

  drawSliceOnCanvasCPU(targetCanvas, segmentPoints, zValue, renderSettings);
}

async function renderSliceToPngBlob(segmentPoints, zValue, renderSettings) {
  const canvas2d = document.createElement("canvas");
  await drawSliceOnCanvas(canvas2d, segmentPoints, zValue, renderSettings);

  return new Promise((resolve) => {
    canvas2d.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      const dataUrl = canvas2d.toDataURL("image/png");
      try {
        const base64 = dataUrl.split(",")[1] || "";
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        resolve(new Blob([bytes], { type: "image/png" }));
      } catch {
        resolve(null);
      }
    }, "image/png");
  });
}

async function requestZipSaveHandle(fileNameToSave) {
  if (!window.showSaveFilePicker) {
    return null;
  }

  const handle = await window.showSaveFilePicker({
    suggestedName: fileNameToSave,
    types: [
      {
        description: "ZIP 檔案",
        accept: {
          "application/zip": [".zip"],
        },
      },
    ],
  });

  return handle;
}

async function saveZipBlob(blob, fileNameToSave, saveHandle = null) {
  if (saveHandle) {
    try {
      const writable = await saveHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      console.warn("透過檔案控制代碼儲存失敗，改用下載", error);
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameToSave;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function exportSectionSlicesAsZip() {
  if (!modelItems.length) {
    fileName.textContent = "請先上傳模型後再匯出剖面";
    return;
  }

  const step = Math.max(0.01, Number(sectionStep.value) || 1);
  const box = previewSliceBounds || getSceneBounds();
  if (!box) {
    fileName.textContent = "找不到模型範圍，無法匯出剖面";
    return;
  }
  const minZ = Math.max(0, box.min.z);
  const maxZ = Math.max(minZ, box.max.z);

  if (maxZ - minZ < 1e-6) {
    fileName.textContent = "模型 Z 高度範圍不足，無法輸出剖面";
    return;
  }

  const zipFileName = "platform_sections.zip";

  let saveHandle = null;
  if (window.showSaveFilePicker) {
    try {
      saveHandle = await requestZipSaveHandle(zipFileName);
    } catch (error) {
      if (error?.name === "AbortError") {
        fileName.textContent = "已取消儲存剖面 ZIP";
        return;
      }

      console.warn("預先取得儲存位置失敗，改用下載方式", error);
      saveHandle = null;
    }
  }

  const zip = new JSZip();
  const total = Math.floor((maxZ - minZ) / step) + 1;
  const selectedSliceEngine = sliceEngine?.value || "cpu";
  let sliceCache = null;
  if (selectedSliceEngine === "cpu") {
    const currentModelSetKey = getCurrentModelSetKey();
    sliceCache =
      previewSliceCache && previewSliceModelSetKey === currentModelSetKey
        ? {
            triangles: previewSliceCache.triangles.slice(),
            triMinZ: previewSliceCache.triMinZ.slice(),
            triMaxZ: previewSliceCache.triMaxZ.slice(),
            triCount: previewSliceCache.triCount,
          }
        : buildSceneSliceCache();

    if (!sliceCache.triCount) {
      fileName.textContent = "模型沒有可用三角形，無法輸出剖面";
      return;
    }
  }

  const platformWidth = Math.max(1, Number(platformWidthInput.value) || 192);
  const platformHeight = Math.max(1, Number(platformHeightInput.value) || 120);
  const outputWidth = Math.max(128, Math.floor(Number(exportWidthInput.value) || 2560));
  const outputHeight = Math.max(128, Math.floor(Number(exportHeightInput.value) || 1600));
  const modelCenter = box.getCenter(new THREE.Vector3());

  fileName.textContent = `剖面匯出中：0/${total}`;

  let generated = 0;
  let addedPngCount = 0;
  for (let i = 0; i < total; i += 1) {
    let z = minZ + i * step;
    if (z > maxZ) {
      z = maxZ;
    }

    generated += 1;
    fileName.textContent = `剖面匯出中：${generated}/${total}`;

    try {
      const segments =
        selectedSliceEngine === "cpu" ? dedupeSegmentPoints(computeSectionSegmentsAtZ(sliceCache, z)) : null;
      const pngBlob = await renderSliceToPngBlob(segments, z, {
        platformWidth,
        platformHeight,
        outputWidth,
        outputHeight,
        centerX: modelCenter.x,
        centerY: modelCenter.y,
        sliceEngine: selectedSliceEngine,
      });

      if (pngBlob) {
        const fileNameInZip = `slice_z_${z.toFixed(2).replace(".", "_")}.png`;
        zip.file(fileNameInZip, pngBlob);
        addedPngCount += 1;
      }
    } catch (sliceError) {
      console.warn(`第 ${generated} 層輸出失敗，略過`, sliceError);
    }

    if (generated % 20 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (!addedPngCount) {
    fileName.textContent = "剖面匯出失敗：沒有可輸出的剖面影像";
    return;
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });

  if (!zipBlob || zipBlob.size === 0) {
    fileName.textContent = "剖面匯出失敗：ZIP 內容為空";
    return;
  }

  try {
    await saveZipBlob(zipBlob, zipFileName, saveHandle);
    fileName.textContent = `剖面匯出完成：${zipFileName}（${addedPngCount} 張）`;
  } catch (error) {
    if (error?.name === "AbortError") {
      fileName.textContent = "已取消儲存剖面 ZIP";
      return;
    }
    console.error(error);

    try {
      await saveZipBlob(zipBlob, zipFileName, null);
      fileName.textContent = `剖面匯出完成（下載備援）：${zipFileName}（${addedPngCount} 張）`;
    } catch (fallbackError) {
      console.error(fallbackError);
      fileName.textContent = "剖面匯出失敗";
    }
  }
}

function resizeRenderer() {
  const width = viewerWrap.clientWidth;
  const height = viewerWrap.clientHeight;
  renderer.setSize(width, height, false);
  sectionLineMaterial.resolution.set(width, height);
  boundaryLineMaterial.resolution.set(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  if (isSlicePreviewMode) {
    updateSlicePreviewAtZ(Number(previewZSlider.value || 0));
  }
}

function clearBoundaryLines() {
  while (boundaryLineGroup.children.length > 0) {
    const child = boundaryLineGroup.children[0];
    boundaryLineGroup.remove(child);
    child.geometry?.dispose();
  }
  boundaryLineGroup.visible = false;
}

function fitCameraToAllModels() {
  if (!modelItems.length) {
    return;
  }

  const merged = getSceneBounds();
  if (!merged) {
    return;
  }

  const size = merged.getSize(new THREE.Vector3());
  const center = merged.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));

  camera.position.copy(center);
  camera.position.x += distance * 1.5;
  camera.position.y += distance * 1.2;
  camera.position.z += distance * 1.5;
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = Math.max(distance * 100, 1000);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  camera.lookAt(center);
  controls.update();
}

function getSceneBounds() {
  if (!modelItems.length) {
    return null;
  }

  const merged = new THREE.Box3();
  modelItems.forEach((item) => {
    merged.union(new THREE.Box3().setFromObject(item.object3D));
  });

  return merged;
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function buildDefaultMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    metalness: 0.1,
    roughness: 0.55,
    side: THREE.DoubleSide,
    clippingPlanes: [sectionPlane],
  });
}

function applyExteriorInteriorShader(material) {
  if (!material || material.userData.exteriorInteriorPatched) {
    return;
  }

  material.userData.exteriorInteriorPatched = true;
  material.userData.exteriorInteriorEnabled = true;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.exteriorFaceColor = { value: exteriorFaceColor.clone() };
    shader.uniforms.interiorFaceColor = { value: interiorFaceColor.clone() };
    shader.uniforms.useExteriorInterior = {
      value: material.userData.exteriorInteriorEnabled ? 1 : 0,
    };

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nuniform vec3 exteriorFaceColor;\nuniform vec3 interiorFaceColor;\nuniform float useExteriorInterior;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>\nif (useExteriorInterior > 0.5) {\n  diffuseColor.rgb = gl_FrontFacing ? exteriorFaceColor : interiorFaceColor;\n}`,
    );

    material.userData.exteriorInteriorShader = shader;
  };

  material.customProgramCacheKey = () => "exteriorInterior_v1";
  material.needsUpdate = true;
}

function setExteriorInteriorMode(material, enabled) {
  applyExteriorInteriorShader(material);
  material.userData.exteriorInteriorEnabled = enabled;
  const shader = material.userData.exteriorInteriorShader;
  if (shader?.uniforms?.useExteriorInterior) {
    shader.uniforms.useExteriorInterior.value = enabled ? 1 : 0;
  }
}

function applySectionPlaneToMesh(mesh) {
  if (!mesh.isMesh || !mesh.material) {
    return;
  }

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((mat) => {
      mat.clippingPlanes = [sectionPlane];
      mat.clipShadows = true;
      mat.needsUpdate = true;
    });
  } else {
    mesh.material.clippingPlanes = [sectionPlane];
    mesh.material.clipShadows = true;
    mesh.material.needsUpdate = true;
  }
}

function setSectionClippingEnabled(enabled) {
  modelItems.forEach((item) => {
    item.object3D.traverse((child) => {
      if (!child.isMesh || !child.material) {
        return;
      }

      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          mat.clippingPlanes = enabled ? [sectionPlane] : [];
          mat.needsUpdate = true;
        });
      } else {
        child.material.clippingPlanes = enabled ? [sectionPlane] : [];
        child.material.needsUpdate = true;
      }
    });
  });
}

function clearSectionLines() {
  while (sectionLineGroup.children.length > 0) {
    const child = sectionLineGroup.children[0];
    sectionLineGroup.remove(child);
    child.geometry?.dispose();
  }
}

function updateSectionIntersectionLines() {
  clearSectionLines();

  if (sectionHeight <= 0) {
    sectionLineGroup.visible = false;
    return;
  }

  const segmentPositions = [];
  const z0 = sectionHeight;

  modelItems.forEach((item) => {
    item.object3D.traverse((child) => {
      if (!child.isMesh || !child.geometry) {
        return;
      }

      const geometry = child.geometry;
      const position = geometry.getAttribute("position");
      if (!position) {
        return;
      }

      const index = geometry.getIndex();
      child.updateWorldMatrix(true, false);

      const readIndex = (idx) => (index ? index.getX(idx) : idx);
      const triCount = index ? index.count / 3 : position.count / 3;

      for (let tri = 0; tri < triCount; tri += 1) {
        const ia = readIndex(tri * 3);
        const ib = readIndex(tri * 3 + 1);
        const ic = readIndex(tri * 3 + 2);

        const a = new THREE.Vector3(position.getX(ia), position.getY(ia), position.getZ(ia)).applyMatrix4(
          child.matrixWorld,
        );
        const b = new THREE.Vector3(position.getX(ib), position.getY(ib), position.getZ(ib)).applyMatrix4(
          child.matrixWorld,
        );
        const c = new THREE.Vector3(position.getX(ic), position.getY(ic), position.getZ(ic)).applyMatrix4(
          child.matrixWorld,
        );

        const hits = [];
        const edges = [
          [a, b],
          [b, c],
          [c, a],
        ];

        edges.forEach(([p1, p2]) => {
          const d1 = p1.z - z0;
          const d2 = p2.z - z0;

          if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) {
            return;
          }

          if (Math.abs(d1 - d2) < 1e-8) {
            return;
          }

          const t = d1 / (d1 - d2);
          if (t < 0 || t > 1) {
            return;
          }

          const point = new THREE.Vector3().lerpVectors(p1, p2, t);
          hits.push(point);
        });

        if (hits.length >= 2) {
          segmentPositions.push(
            hits[0].x,
            hits[0].y,
            hits[0].z + 0.001,
            hits[1].x,
            hits[1].y,
            hits[1].z + 0.001,
          );
        }
      }
    });
  });

  if (!segmentPositions.length) {
    sectionLineGroup.visible = false;
    return;
  }

  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(segmentPositions);
  const lines = new LineSegments2(lineGeometry, sectionLineMaterial);
  lines.computeLineDistances();
  sectionLineGroup.add(lines);
  sectionLineGroup.visible = true;
}

async function loadModel(file) {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith(".stl")) {
    const loader = new STLLoader();
    const buffer = await readFileAsArrayBuffer(file);
    const geometry = loader.parse(buffer);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, buildDefaultMaterial());
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  if (lowerName.endsWith(".obj")) {
    const loader = new OBJLoader();
    const text = await readFileAsText(file);
    const object = loader.parse(text);

    object.traverse((child) => {
      if (child.isMesh && !child.material) {
        child.material = buildDefaultMaterial();
      }
    });

    return object;
  }

  throw new Error("目前僅支援 .stl 或 .obj 檔案");
}

function countModelStats(object3D) {
  let vertices = 0;
  let faces = 0;

  object3D.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    const positionAttr = child.geometry.getAttribute("position");
    const indexAttr = child.geometry.getIndex();

    vertices += positionAttr ? positionAttr.count : 0;
    faces += indexAttr ? indexAttr.count / 3 : positionAttr ? positionAttr.count / 3 : 0;
  });

  return {
    vertices: Math.round(vertices),
    faces: Math.round(faces),
  };
}

function setObjectRenderMode(object3D, mode) {
  object3D.traverse((child) => {
    if (child.isMesh && child.material) {
      applySectionPlaneToMesh(child);
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          mat.wireframe = mode === "wire";
          mat.vertexColors = false;
          setExteriorInteriorMode(mat, mode === "solid");
          mat.color.setHex(mode === "solid" ? 0xffffff : child.userData.baseColor || 0x3b82f6);
        });
      } else {
        child.material.wireframe = mode === "wire";
        child.material.vertexColors = false;
        setExteriorInteriorMode(child.material, mode === "solid");
        child.material.color.setHex(mode === "solid" ? 0xffffff : child.userData.baseColor || 0x3b82f6);
      }
    }
  });
}

function getSceneHighestZ() {
  const bounds = getSceneBounds();
  if (!bounds) {
    return 0;
  }

  return Number(Math.max(0, bounds.max.z).toFixed(3));
}

function updateSectionPlane(zValue) {
  sectionHeight = Math.max(0, zValue);
  const enabled = sectionHeight > 0;
  sectionPlane.constant = -sectionHeight;
  setSectionClippingEnabled(enabled);
  sectionValue.textContent = `Z: ${sectionHeight.toFixed(2)}`;
  updateSectionFillMesh();
  updateSectionIntersectionLines();
}

function updateSectionSliderRange() {
  const maxZ = getSceneHighestZ();
  sectionSlider.max = `${maxZ}`;
  if (Number(sectionSlider.value) > maxZ) {
    sectionSlider.value = `${maxZ}`;
  }

  const nextZ = Number(sectionSlider.value || 0);
  updateSectionPlane(nextZ);
}

function updateSectionFillMesh() {
  const bounds = getSceneBounds();
  if (!bounds || !sectionFillToggle.checked || sectionHeight <= 0) {
    sectionFrameLine.visible = false;
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const planeSize = Math.max(size.x, size.y, 10) * 1.2;

  sectionFrameLine.visible = true;
  sectionFrameLine.scale.set(planeSize, planeSize, 1);
  sectionFrameLine.position.set(center.x, center.y, sectionHeight + 0.001);
  sectionFrameMaterial.color.set(sectionFillColor.value);
}

function getCurrentSliceRenderSettings() {
  const platformWidth = Math.max(1, Number(platformWidthInput.value) || 192);
  const platformHeight = Math.max(1, Number(platformHeightInput.value) || 120);
  const outputWidth = Math.max(128, Math.floor(Number(exportWidthInput.value) || 2560));
  const outputHeight = Math.max(128, Math.floor(Number(exportHeightInput.value) || 1600));

  const bounds = previewSliceBounds || getSceneBounds();
  const center = bounds ? bounds.getCenter(new THREE.Vector3()) : new THREE.Vector3();

  return {
    platformWidth,
    platformHeight,
    outputWidth,
    outputHeight,
    centerX: center.x,
    centerY: center.y,
    sliceEngine: sliceEngine?.value || "cpu",
  };
}

function getPreviewRenderSettings() {
  const base = getCurrentSliceRenderSettings();
  const width = Math.max(320, Math.floor(slicePreviewCanvas.clientWidth || viewerWrap.clientWidth || 1280));
  const height = Math.max(320, Math.floor(slicePreviewCanvas.clientHeight || viewerWrap.clientHeight || 720));

  return {
    ...base,
    outputWidth: width,
    outputHeight: height,
  };
}

async function updateSlicePreviewAtZ(zValue) {
  if (!isSlicePreviewMode) {
    return;
  }

  const token = ++previewRequestToken;
  const startTime = performance.now();
  previewZValue.textContent = `Z: ${Number(zValue).toFixed(2)}`;

  const selectedSliceEngine = sliceEngine?.value || "cpu";
  let segments = null;

  if (selectedSliceEngine === "cpu") {
    if (!previewSliceCache) {
      return;
    }

    if (sliceWorkerReady) {
      try {
        segments = await computeSliceSegmentsWithWorker(zValue);
      } catch (error) {
        console.warn("預覽 worker 計算失敗，改主執行緒", error);
        segments = dedupeSegmentPoints(computeSectionSegmentsAtZ(previewSliceCache, zValue));
      }
    } else {
      segments = dedupeSegmentPoints(computeSectionSegmentsAtZ(previewSliceCache, zValue));
    }

    if (sliceWorkerReady) {
      segments = dedupeSegmentPoints(segments);
    }
  }

  if (token !== previewRequestToken) {
    return;
  }

  await drawSliceOnCanvas(slicePreviewCanvas, segments, zValue, {
    ...getPreviewRenderSettings(),
    sliceEngine: selectedSliceEngine,
  });
  const elapsed = performance.now() - startTime;
  previewPerfText.textContent = `計算：${elapsed.toFixed(1)} ms（${selectedSliceEngine.toUpperCase()}）`;
}

async function enterSlicePreviewMode() {
  if (!modelItems.length) {
    fileName.textContent = "請先上傳模型再切換切層預覽";
    return;
  }

  const bounds = getSceneBounds();
  if (!bounds) {
    fileName.textContent = "找不到模型範圍，無法切層預覽";
    return;
  }

  const minZ = Math.max(0, bounds.min.z);
  const maxZ = Math.max(minZ, bounds.max.z);
  if (maxZ - minZ < 1e-6) {
    fileName.textContent = "模型 Z 高度範圍不足，無法切層預覽";
    return;
  }

  const selectedSliceEngine = sliceEngine?.value || "cpu";
  let cache = null;

  if (selectedSliceEngine === "cpu") {
    const currentModelSetKey = getCurrentModelSetKey();
    cache = buildSceneSliceCache();
    if (!cache.triCount) {
      fileName.textContent = "模型沒有可用三角形，無法切層預覽";
      return;
    }
    previewSliceModelSetKey = currentModelSetKey;
  } else {
    previewSliceModelSetKey = "";
  }

  previewSliceBounds = bounds;
  previewSliceCache = cache;

  if (selectedSliceEngine === "cpu" && cache) {
    try {
      await initSliceWorkerWithCache({
        triangles: cache.triangles.slice(),
        triMinZ: cache.triMinZ.slice(),
        triMaxZ: cache.triMaxZ.slice(),
        triCount: cache.triCount,
      });
    } catch (error) {
      console.warn("預覽模式 worker 初始化失敗，改用主執行緒", error);
    }
  }

  previewZSlider.min = `${minZ}`;
  previewZSlider.max = `${maxZ}`;
  previewZSlider.step = `${Math.max(0.01, Number(sectionStep.value) || 1)}`;
  const startZ = Math.min(Math.max(Number(sectionSlider.value || minZ), minZ), maxZ);
  previewZSlider.value = `${startZ}`;

  isSlicePreviewMode = true;
  slicePreviewOverlay.classList.remove("is-hidden");
  enterSlicePreviewBtn.style.display = "none";
  renderer.domElement.style.visibility = "hidden";

  await updateSlicePreviewAtZ(startZ);
}

function exitSlicePreviewMode() {
  isSlicePreviewMode = false;
  previewRequestToken += 1;
  slicePreviewOverlay.classList.add("is-hidden");
  enterSlicePreviewBtn.style.display = "";
  renderer.domElement.style.visibility = "visible";
}

function applyRenderMode(mode) {
  renderMode = mode;
  modelItems.forEach((item) => {
    setObjectRenderMode(item.object3D, mode);
  });

  renderSolidBtn.classList.toggle("is-active", mode === "solid");
  renderWireBtn.classList.toggle("is-active", mode === "wire");
}

function setActiveModel(modelId) {
  activeModelId = modelId;
  clearBoundaryLines();

  modelItems.forEach((item) => {
    item.object3D.traverse((child) => {
      if (!child.isMesh || !child.material || !child.userData.baseColor) {
        return;
      }

      const targetColor = item.id === modelId ? 0xf97316 : child.userData.baseColor;
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          mat.emissive?.setHex(item.id === modelId ? 0x331100 : 0x000000);
          if (renderMode === "wire") {
            mat.color.setHex(targetColor);
          }
        });
      } else {
        child.material.emissive?.setHex(item.id === modelId ? 0x331100 : 0x000000);
        if (renderMode === "wire") {
          child.material.color.setHex(targetColor);
        }
      }
    });
  });

  const selected = modelItems.find((item) => item.id === modelId) || null;
  updateModelInfoPanel(selected);
}

function detectBoundaryForActiveModel() {
  clearBoundaryLines();

  const targetItem = modelItems.find((item) => item.id === activeModelId);
  if (!targetItem) {
    fileName.textContent = "請先左鍵選取要辨識的模型";
    return;
  }

  const segmentPositions = [];
  const sensitivityValue = Number(boundarySensitivity.value || 60);
  const sensitivityNorm = Math.max(0, Math.min(1, sensitivityValue / 100));

  targetItem.object3D.traverse((child) => {
    if (!child.isMesh || !child.geometry) {
      return;
    }

    const geometry = child.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.count < 3) {
      return;
    }

    const index = geometry.getIndex();
    const vertexCount = position.count;
    const vertexToWeld = new Uint32Array(vertexCount);
    const weldedPositions = [];
    const weldMap = new Map();

    // Weld duplicated vertices so STL models (non-indexed) can build true neighborhood.
    for (let i = 0; i < vertexCount; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const key = `${Math.round(x * 10000)}_${Math.round(y * 10000)}_${Math.round(z * 10000)}`;
      let weldId = weldMap.get(key);
      if (weldId === undefined) {
        weldId = weldedPositions.length;
        weldMap.set(key, weldId);
        weldedPositions.push(new THREE.Vector3(x, y, z));
      }
      vertexToWeld[i] = weldId;
    }

    const weldedCount = weldedPositions.length;
    if (weldedCount < 3) {
      return;
    }

    let localMin = new THREE.Vector3(Infinity, Infinity, Infinity);
    let localMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < weldedCount; i += 1) {
      localMin.min(weldedPositions[i]);
      localMax.max(weldedPositions[i]);
    }
    const localDiagonal = localMax.distanceTo(localMin);

    const neighbors = Array.from({ length: weldedCount }, () => new Set());
    const edges = [];
    const edgeSet = new Set();
    const readIndex = (idx) => (index ? index.getX(idx) : idx);
    const triCount = index ? index.count / 3 : Math.floor(vertexCount / 3);

    const normalSum = Array.from({ length: weldedCount }, () => new THREE.Vector3());
    const avgNormal = Array.from({ length: weldedCount }, () => new THREE.Vector3(0, 0, 1));

    const addEdge = (a, b) => {
      if (a === b) return;
      neighbors[a].add(b);
      neighbors[b].add(a);
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const key = `${min}_${max}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push([min, max]);
      }
    };

    for (let tri = 0; tri < triCount; tri += 1) {
      const ia = vertexToWeld[readIndex(tri * 3)];
      const ib = vertexToWeld[readIndex(tri * 3 + 1)];
      const ic = vertexToWeld[readIndex(tri * 3 + 2)];
      if (ia === ib || ib === ic || ic === ia) {
        continue;
      }

      addEdge(ia, ib);
      addEdge(ib, ic);
      addEdge(ic, ia);

      const a = weldedPositions[ia];
      const b = weldedPositions[ib];
      const c = weldedPositions[ic];
      const triNormal = new THREE.Vector3().crossVectors(
        new THREE.Vector3().subVectors(b, a),
        new THREE.Vector3().subVectors(c, a),
      );

      if (triNormal.lengthSq() > 1e-12) {
        triNormal.normalize();
        normalSum[ia].add(triNormal);
        normalSum[ib].add(triNormal);
        normalSum[ic].add(triNormal);
      }
    }

    for (let i = 0; i < weldedCount; i += 1) {
      if (normalSum[i].lengthSq() > 1e-12) {
        avgNormal[i].copy(normalSum[i]).normalize();
      }
    }

    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < weldedCount; i += 1) {
      const z = weldedPositions[i].z;
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const zRange = Math.max(maxZ - minZ, 1e-8);

    const feature = new Float32Array(weldedCount);
    for (let i = 0; i < weldedCount; i += 1) {
      let sum = 0;
      let count = 0;

      neighbors[i].forEach((j) => {
        const dot = avgNormal[i].dot(avgNormal[j]);
        sum += 1 - Math.max(-1, Math.min(1, dot));
        count += 1;
      });

      const curvatureLike = count > 0 ? sum / count : 0;
      const zNorm = (weldedPositions[i].z - minZ) / zRange;
      feature[i] = curvatureLike + zNorm * 0.12;
    }

    // Smooth feature to stabilize noisy scans.
    for (let iter = 0; iter < 2; iter += 1) {
      const smoothed = new Float32Array(weldedCount);
      for (let i = 0; i < weldedCount; i += 1) {
        let sum = feature[i];
        let count = 1;
        neighbors[i].forEach((j) => {
          sum += feature[j];
          count += 1;
        });
        smoothed[i] = sum / count;
      }
      feature.set(smoothed);
    }

    let c0 = Infinity;
    let c1 = -Infinity;
    for (let i = 0; i < weldedCount; i += 1) {
      c0 = Math.min(c0, feature[i]);
      c1 = Math.max(c1, feature[i]);
    }
    const featureRange = Math.max(c1 - c0, 1e-8);

    const labels = new Uint8Array(weldedCount);
    const values = Array.from(feature);
    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)] || 0;

    if (Math.abs(c1 - c0) < 1e-8) {
      for (let i = 0; i < weldedCount; i += 1) {
        labels[i] = feature[i] >= median ? 1 : 0;
      }
    }

    for (let iter = 0; iter < 10; iter += 1) {
      let s0 = 0;
      let s1 = 0;
      let n0 = 0;
      let n1 = 0;

      for (let i = 0; i < weldedCount; i += 1) {
        const d0 = Math.abs(feature[i] - c0);
        const d1 = Math.abs(feature[i] - c1);
        labels[i] = d0 <= d1 ? 0 : 1;
        if (labels[i] === 0) {
          s0 += feature[i];
          n0 += 1;
        } else {
          s1 += feature[i];
          n1 += 1;
        }
      }

      if (n0 > 0) c0 = s0 / n0;
      if (n1 > 0) c1 = s1 / n1;

      if (n0 === 0 || n1 === 0) {
        for (let i = 0; i < weldedCount; i += 1) {
          labels[i] = feature[i] >= median ? 1 : 0;
        }
        break;
      }
    }

    child.updateWorldMatrix(true, false);
    const boundaryThreshold = (1 - sensitivityNorm) * featureRange * 0.35;
    const labeledBoundaryEdges = [];

    edges.forEach(([a, b]) => {
      if (labels[a] === labels[b]) {
        return;
      }

      const deltaFeature = Math.abs(feature[a] - feature[b]);
      if (deltaFeature < boundaryThreshold) {
        return;
      }

      labeledBoundaryEdges.push({ a, b, deltaFeature });
    });

    // Fallback to non-threshold boundary edges if threshold is too strict.
    const rawBoundaryEdges = labeledBoundaryEdges.length
      ? labeledBoundaryEdges
      : edges
          .filter(([a, b]) => labels[a] !== labels[b])
          .map(([a, b]) => ({ a, b, deltaFeature: Math.abs(feature[a] - feature[b]) }));

    if (!rawBoundaryEdges.length) {
      return;
    }

    const minEdgeLength = Math.max(1e-6, localDiagonal * 0.004 * (1.1 - sensitivityNorm * 0.4));
    const lengthFiltered = rawBoundaryEdges.filter(({ a, b }) => {
      return weldedPositions[a].distanceTo(weldedPositions[b]) >= minEdgeLength;
    });

    // If length filter over-prunes on very dense meshes, fallback once.
    const edgesAfterLength = lengthFiltered.length ? lengthFiltered : rawBoundaryEdges;

    const vertexToEdge = Array.from({ length: weldedCount }, () => []);
    edgesAfterLength.forEach((edge, idx) => {
      vertexToEdge[edge.a].push(idx);
      vertexToEdge[edge.b].push(idx);
    });

    const visited = new Uint8Array(edgesAfterLength.length);
    const components = [];

    for (let i = 0; i < edgesAfterLength.length; i += 1) {
      if (visited[i]) {
        continue;
      }

      const stack = [i];
      visited[i] = 1;
      const comp = [];

      while (stack.length) {
        const eIdx = stack.pop();
        comp.push(eIdx);
        const edge = edgesAfterLength[eIdx];
        const incident = [...vertexToEdge[edge.a], ...vertexToEdge[edge.b]];
        incident.forEach((nIdx) => {
          if (!visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        });
      }

      components.push(comp);
    }

    const minComponentEdges = Math.max(5, Math.floor(edgesAfterLength.length * 0.02));
    const largeComponents = components.filter((comp) => comp.length >= minComponentEdges);
    const componentFiltered = (largeComponents.length ? largeComponents : components).flatMap((comp) =>
      comp.map((idx) => edgesAfterLength[idx]),
    );

    // Curvature-consistency filter: suppress sparse noisy spikes inside each component.
    const groupedForConsistency = [];
    const compSource = largeComponents.length ? largeComponents : components;
    compSource.forEach((comp) => {
      const compEdges = comp.map((idx) => edgesAfterLength[idx]);
      const mean = compEdges.reduce((acc, e) => acc + e.deltaFeature, 0) / compEdges.length;
      const variance =
        compEdges.reduce((acc, e) => acc + (e.deltaFeature - mean) * (e.deltaFeature - mean), 0) /
        compEdges.length;
      const std = Math.sqrt(Math.max(variance, 0));
      const lowerBound = Math.max(0, mean - std * 0.75);
      const stable = compEdges.filter((e) => e.deltaFeature >= lowerBound);
      groupedForConsistency.push(...(stable.length ? stable : compEdges));
    });

    const finalEdges = groupedForConsistency.length ? groupedForConsistency : componentFiltered;

    finalEdges.forEach(({ a, b }) => {

      const va = weldedPositions[a];
      const vb = weldedPositions[b];

      const pa = va.clone().applyMatrix4(child.matrixWorld);
      const pb = vb.clone().applyMatrix4(child.matrixWorld);

      segmentPositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
    });
  });

  if (!segmentPositions.length) {
    fileName.textContent = "交界辨識完成，但未找到明顯分界";
    return;
  }

  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(segmentPositions);
  const lines = new LineSegments2(lineGeometry, boundaryLineMaterial);
  lines.computeLineDistances();
  boundaryLineGroup.add(lines);
  boundaryLineGroup.visible = true;
  fileName.textContent = `交界辨識完成：${targetItem.fileName}`;
}

function updateModelInfoPanel(modelItem) {
  if (!modelItem) {
    modelInfo.innerHTML = "<div>檔案：未選取</div><div>點數：-</div><div>網格數：-</div>";
    return;
  }

  modelInfo.innerHTML = `<div>檔案：${modelItem.fileName}</div><div>點數：${modelItem.vertices.toLocaleString()}</div><div>網格數：${modelItem.faces.toLocaleString()}</div>`;
}

function assignModelMetadata(object3D, id) {
  object3D.userData.modelId = id;
  object3D.traverse((child) => {
    child.userData.modelId = id;
    if (child.isMesh && child.geometry && child.material) {
      applySectionPlaneToMesh(child);
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          applyExteriorInteriorShader(mat);
          if (mat.color) {
            child.userData.baseColor = mat.color.getHex();
          }
        });
      } else if (child.material.color) {
        applyExteriorInteriorShader(child.material);
        child.userData.baseColor = child.material.color.getHex();
      }
    }
  });
}

function setCameraPreset(viewKey) {
  const target = controls.target.clone();
  const presets = {
    iso: { direction: new THREE.Vector3(1, -1, 1), up: new THREE.Vector3(0, 0, 1) },
    front: { direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
    back: { direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) },
    left: { direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
    right: { direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
    top: { direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
    bottom: { direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) },
  };

  const preset = presets[viewKey] || presets.iso;

  const distance = camera.position.distanceTo(target);
  camera.up.copy(preset.up);
  camera.position.copy(target.clone().add(preset.direction.clone().normalize().multiplyScalar(distance)));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  controls.update();
}

function rotateCameraByRightDrag(deltaX, deltaY) {
  const yaw = -deltaX * 0.006;
  const pitch = -deltaY * 0.006;

  const target = controls.target.clone();
  const offset = camera.position.clone().sub(target);
  if (offset.lengthSq() === 0) return;

  const yawQuat = new THREE.Quaternion().setFromAxisAngle(worldUp, yaw);
  camera.getWorldDirection(tempDirection).normalize();
  tempRightAxis.crossVectors(tempDirection, worldUp).normalize();

  if (tempRightAxis.lengthSq() < 1e-10) {
    tempRightAxis.copy(tempUpAxis.set(1, 0, 0));
  }

  const pitchQuat = new THREE.Quaternion().setFromAxisAngle(tempRightAxis, pitch);
  const rotation = yawQuat.multiply(pitchQuat);
  offset.applyQuaternion(rotation);

  camera.position.copy(target).add(offset);
  camera.up.applyQuaternion(rotation).normalize();
  if (camera.up.lengthSq() < 1e-8) {
    camera.up.copy(worldUp);
  }
  camera.lookAt(target);
  controls.update();
}

function selectModelByPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  modelItems.forEach((item) => {
    item.object3D.traverse((child) => {
      if (child.isMesh) {
        meshes.push(child);
      }
    });
  });

  const intersects = raycaster.intersectObjects(meshes, false);
  if (!intersects.length) {
    return;
  }

  const modelId = intersects[0].object.userData.modelId;
  if (modelId) {
    setActiveModel(modelId);
  }
}

async function handleSelectedFile(selectedFile) {
  if (!selectedFile) {
    return;
  }

  fileName.textContent = `載入中：${selectedFile.name}`;

  try {
    const model = await loadModel(selectedFile);
    const id = crypto.randomUUID();
    assignModelMetadata(model, id);
    setObjectRenderMode(model, renderMode);

    const stats = countModelStats(model);
    const modelItem = {
      id,
      fileName: selectedFile.name,
      vertices: stats.vertices,
      faces: stats.faces,
      object3D: model,
    };

    modelItems.push(modelItem);
    modelSliceCacheMap.delete(id);
    previewSliceCache = null;
    previewSliceBounds = null;
    previewSliceModelSetKey = "";
    scene.add(model);
    clearBoundaryLines();
    updateSectionSliderRange();
    fitCameraToAllModels();
    setActiveModel(id);
    fileName.textContent = `已載入：${selectedFile.name}`;
  } catch (error) {
    console.error(error);
    fileName.textContent = "檔案讀取失敗，請確認格式是否正確";
  }
}

fileInput.addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  for (const file of files) {
    await handleSelectedFile(file);
  }
});

viewerWrap.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragCounter += 1;
  viewerWrap.classList.add("drag-active");
});

viewerWrap.addEventListener("dragover", (event) => {
  event.preventDefault();
});

viewerWrap.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragCounter -= 1;
  if (dragCounter <= 0) {
    dragCounter = 0;
    viewerWrap.classList.remove("drag-active");
  }
});

viewerWrap.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragCounter = 0;
  viewerWrap.classList.remove("drag-active");

  const droppedFiles = [...(event.dataTransfer?.files || [])];
  for (const file of droppedFiles) {
    await handleSelectedFile(file);
  }
});

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button === 2) {
    isRightDragging = true;
    rightDragPointerId = event.pointerId;
    lastPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture(event.pointerId);
    return;
  }

  if (event.button === 0) {
    selectModelByPointer(event);
  }
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!isRightDragging || event.pointerId !== rightDragPointerId) {
    return;
  }

  const deltaX = event.clientX - lastPointer.x;
  const deltaY = event.clientY - lastPointer.y;
  lastPointer.set(event.clientX, event.clientY);

  rotateCameraByRightDrag(deltaX, deltaY);
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!isRightDragging || event.pointerId !== rightDragPointerId) {
    return;
  }

  isRightDragging = false;
  rightDragPointerId = null;
  renderer.domElement.releasePointerCapture(event.pointerId);
});

renderer.domElement.addEventListener("pointercancel", () => {
  isRightDragging = false;
  rightDragPointerId = null;
});

viewToolbar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) {
    return;
  }

  setCameraPreset(button.dataset.view);
});

renderSolidBtn.addEventListener("click", () => {
  applyRenderMode("solid");
});

renderWireBtn.addEventListener("click", () => {
  applyRenderMode("wire");
});

detectBoundaryBtn.addEventListener("click", () => {
  detectBoundaryForActiveModel();
});

enterSlicePreviewBtn.addEventListener("click", async () => {
  await enterSlicePreviewMode();
});

previewBackBtn.addEventListener("click", () => {
  exitSlicePreviewMode();
});

previewExportBtn.addEventListener("click", async () => {
  await exportSectionSlicesAsZip();
});

boundarySensitivity.addEventListener("input", () => {
  boundarySensitivityValue.textContent = boundarySensitivity.value;
});

sectionStep.addEventListener("change", () => {
  const parsedStep = Number(sectionStep.value);
  const validStep = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
  sectionStep.value = `${validStep}`;
  sectionSlider.step = `${validStep}`;
  previewZSlider.step = `${validStep}`;
  if (isSlicePreviewMode) {
    updateSlicePreviewAtZ(Number(previewZSlider.value || 0));
  }
});

sliceEngine.addEventListener("change", () => {
  if (isSlicePreviewMode) {
    enterSlicePreviewMode();
  }
});

platformWidthInput.addEventListener("change", () => {
  const value = Math.max(1, Number(platformWidthInput.value) || 192);
  platformWidthInput.value = `${value}`;
  updatePlatformGridFromInputs();
  if (isSlicePreviewMode) {
    updateSlicePreviewAtZ(Number(previewZSlider.value || 0));
  }
});

platformHeightInput.addEventListener("change", () => {
  const value = Math.max(1, Number(platformHeightInput.value) || 120);
  platformHeightInput.value = `${value}`;
  updatePlatformGridFromInputs();
  if (isSlicePreviewMode) {
    updateSlicePreviewAtZ(Number(previewZSlider.value || 0));
  }
});

sectionSlider.addEventListener("input", () => {
  updateSectionPlane(Number(sectionSlider.value));
});

previewZSlider.addEventListener("input", async () => {
  await updateSlicePreviewAtZ(Number(previewZSlider.value));
});

sectionFillToggle.addEventListener("change", () => {
  updateSectionFillMesh();
});

sectionFillColor.addEventListener("input", () => {
  sectionFrameMaterial.color.set(sectionFillColor.value);
  updateSectionFillMesh();
});

window.addEventListener("resize", resizeRenderer);
resizeRenderer();
updateSectionPlane(0);
sectionSlider.step = sectionStep.value;
boundarySensitivityValue.textContent = boundarySensitivity.value;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
