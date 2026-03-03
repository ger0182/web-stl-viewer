import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

const canvas = document.getElementById("viewerCanvas");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const viewerWrap = document.querySelector(".viewer-wrap");
const viewToolbar = document.getElementById("viewToolbar");
const modelInfo = document.getElementById("modelInfo");
const renderSolidBtn = document.getElementById("renderSolid");
const renderWireBtn = document.getElementById("renderWire");
const sectionSlider = document.getElementById("sectionSlider");
const sectionStep = document.getElementById("sectionStep");
const sectionValue = document.getElementById("sectionValue");
const sectionFillToggle = document.getElementById("sectionFillToggle");
const sectionFillColor = document.getElementById("sectionFillColor");

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

const grid = new THREE.GridHelper(300, 20, 0x9ca3af, 0xd1d5db);
grid.rotation.x = Math.PI / 2;
grid.position.z = 0;
scene.add(grid);

const axis = new THREE.AxesHelper(80);
scene.add(axis);

const modelItems = [];
let activeModelId = null;
let dragCounter = 0;
let renderMode = "solid";
let sectionHeight = 0;
let isRightDragging = false;
let rightDragPointerId = null;
let isSectionSliderDragging = false;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const lastPointer = new THREE.Vector2();
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const worldUp = new THREE.Vector3(0, 0, 1);
const tempDirection = new THREE.Vector3();
const tempRightAxis = new THREE.Vector3();
const tempUpAxis = new THREE.Vector3();

const sectionLineMaterial = new THREE.LineBasicMaterial({
  color: 0x111827,
  transparent: true,
  opacity: 0.95,
});
const sectionLineGroup = new THREE.Group();
sectionLineGroup.visible = false;
scene.add(sectionLineGroup);

const sectionFillMaterial = new THREE.MeshBasicMaterial({
  color: sectionFillColor.value,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const sectionFillMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sectionFillMaterial);
sectionFillMesh.visible = false;
sectionFillMesh.renderOrder = 3;
scene.add(sectionFillMesh);

function resizeRenderer() {
  const width = viewerWrap.clientWidth;
  const height = viewerWrap.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
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

function buildSegmentedVertexColors(geometry) {
  const position = geometry.getAttribute("position");
  if (!position || !position.count) {
    return;
  }

  geometry.computeBoundingBox();
  const minZ = geometry.boundingBox?.min.z ?? 0;
  const maxZ = geometry.boundingBox?.max.z ?? 1;
  const range = Math.max(maxZ - minZ, 1e-6);
  const bandSize = range / 6;
  const colors = new Float32Array(position.count * 3);
  const palette = [0x4f46e5, 0x3b82f6, 0x06b6d4, 0x10b981, 0xf59e0b, 0xef4444];

  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    const bandIndex = Math.min(
      palette.length - 1,
      Math.max(0, Math.floor((z - minZ) / Math.max(bandSize, 1e-6))),
    );
    const color = new THREE.Color(palette[bandIndex]);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

  if (!isSectionSliderDragging || sectionHeight <= 0) {
    sectionLineGroup.visible = false;
    return;
  }

  const segmentPoints = [];
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
          segmentPoints.push(hits[0], hits[1]);
        }
      }
    });
  });

  if (!segmentPoints.length) {
    sectionLineGroup.visible = false;
    return;
  }

  const lineGeometry = new THREE.BufferGeometry().setFromPoints(segmentPoints);
  const lines = new THREE.LineSegments(lineGeometry, sectionLineMaterial);
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
          mat.vertexColors = mode === "solid";
          mat.color.setHex(mode === "solid" ? 0xffffff : child.userData.baseColor || 0x3b82f6);
        });
      } else {
        child.material.wireframe = mode === "wire";
        child.material.vertexColors = mode === "solid";
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
    sectionFillMesh.visible = false;
    return;
  }

  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const planeSize = Math.max(size.x, size.y, 10) * 1.2;

  sectionFillMesh.visible = true;
  sectionFillMesh.scale.set(planeSize, planeSize, 1);
  sectionFillMesh.position.set(center.x, center.y, sectionHeight + 0.001);
  sectionFillMaterial.color.set(sectionFillColor.value);
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
      buildSegmentedVertexColors(child.geometry);
      applySectionPlaneToMesh(child);
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          if (mat.color) {
            child.userData.baseColor = mat.color.getHex();
          }
        });
      } else if (child.material.color) {
        child.userData.baseColor = child.material.color.getHex();
      }
    }
  });
}

function setCameraPreset(viewKey) {
  const target = controls.target.clone();
  let direction = new THREE.Vector3(1, -1, 1);

  if (viewKey === "front") direction = new THREE.Vector3(0, -1, 0);
  if (viewKey === "back") direction = new THREE.Vector3(0, 1, 0);
  if (viewKey === "left") direction = new THREE.Vector3(-1, 0, 0);
  if (viewKey === "right") direction = new THREE.Vector3(1, 0, 0);
  if (viewKey === "top") direction = new THREE.Vector3(0, 0, 1);
  if (viewKey === "bottom") direction = new THREE.Vector3(0, 0, -1);

  const distance = camera.position.distanceTo(target);
  camera.position.copy(target.clone().add(direction.normalize().multiplyScalar(distance)));
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
    scene.add(model);
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

sectionStep.addEventListener("change", () => {
  const parsedStep = Number(sectionStep.value);
  const validStep = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
  sectionStep.value = `${validStep}`;
  sectionSlider.step = `${validStep}`;
});

sectionSlider.addEventListener("input", () => {
  updateSectionPlane(Number(sectionSlider.value));
});

sectionSlider.addEventListener("pointerdown", () => {
  isSectionSliderDragging = true;
  updateSectionIntersectionLines();
});

window.addEventListener("pointerup", () => {
  if (!isSectionSliderDragging) {
    return;
  }

  isSectionSliderDragging = false;
  updateSectionIntersectionLines();
});

sectionFillToggle.addEventListener("change", () => {
  updateSectionFillMesh();
});

sectionFillColor.addEventListener("input", () => {
  sectionFillMaterial.color.set(sectionFillColor.value);
  updateSectionFillMesh();
});

window.addEventListener("resize", resizeRenderer);
resizeRenderer();
updateSectionPlane(0);
sectionSlider.step = sectionStep.value;

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
