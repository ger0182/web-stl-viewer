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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe5e7eb);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
camera.position.set(0, 0, 150);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(80, 100, 120);
scene.add(dirLight);

const grid = new THREE.GridHelper(300, 20, 0x9ca3af, 0xd1d5db);
grid.position.y = -50;
scene.add(grid);

const axis = new THREE.AxesHelper(80);
scene.add(axis);

const modelItems = [];
let activeModelId = null;
let dragCounter = 0;
let renderMode = "solid";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function resizeRenderer() {
  const width = viewerWrap.clientWidth;
  const height = viewerWrap.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function clearAllModels() {
  if (!modelItems.length) {
    return;
  }

  modelItems.forEach((item) => {
    scene.remove(item.object3D);
    item.object3D.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
  });

  modelItems.length = 0;
  activeModelId = null;
  updateModelInfoPanel(null);
}

function fitCameraToObject(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

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
  controls.update();
}

function fitCameraToAllModels() {
  if (!modelItems.length) {
    return;
  }

  const merged = new THREE.Box3();
  modelItems.forEach((item) => {
    merged.union(new THREE.Box3().setFromObject(item.object3D));
  });

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
  controls.update();
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
  });
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
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          mat.wireframe = mode === "wire";
        });
      } else {
        child.material.wireframe = mode === "wire";
      }
    }
  });
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
        child.material.forEach((mat) => mat.color.setHex(targetColor));
      } else {
        child.material.color.setHex(targetColor);
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
    if (child.isMesh && child.material) {
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
  let direction = new THREE.Vector3(1, 1, 1);

  if (viewKey === "front") direction = new THREE.Vector3(0, 0, 1);
  if (viewKey === "back") direction = new THREE.Vector3(0, 0, -1);
  if (viewKey === "left") direction = new THREE.Vector3(-1, 0, 0);
  if (viewKey === "right") direction = new THREE.Vector3(1, 0, 0);
  if (viewKey === "top") direction = new THREE.Vector3(0, 1, 0);
  if (viewKey === "bottom") direction = new THREE.Vector3(0, -1, 0);

  const distance = camera.position.distanceTo(target);
  camera.position.copy(target.clone().add(direction.normalize().multiplyScalar(distance)));
  camera.updateProjectionMatrix();
  controls.update();
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

viewerWrap.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) {
    return;
  }

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

window.addEventListener("resize", resizeRenderer);
resizeRenderer();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
