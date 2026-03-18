let triangles = null;
let triMinZ = null;
let triMaxZ = null;
let triCount = 0;

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

function computeSliceSegments(z0) {
  const segmentPoints = [];

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

  return new Float32Array(segmentPoints);
}

self.onmessage = (event) => {
  const data = event.data;

  if (data.type === "init") {
    triangles = new Float32Array(data.trianglesBuffer);
    triMinZ = new Float32Array(data.triMinZBuffer);
    triMaxZ = new Float32Array(data.triMaxZBuffer);
    triCount = data.triCount;
    self.postMessage({ type: "inited" });
    return;
  }

  if (data.type === "slice") {
    const segments = computeSliceSegments(data.z);
    self.postMessage(
      {
        type: "sliceResult",
        requestId: data.requestId,
        segmentsBuffer: segments.buffer,
      },
      [segments.buffer],
    );
  }
};
