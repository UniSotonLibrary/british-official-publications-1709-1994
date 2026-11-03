import { Delaunay } from "d3-delaunay";
import fs from "fs";

const FRAME = { x: 16, y: 16, w: 948, h: 528 };
const GAP = "1cm";
const topics = [
  ["justice", 2], ["economy", 1.809], ["land", 1.5], ["education", 1.342],
  ["transport", 1.203], ["welfare", 1.2], ["agriculture", 1.194], ["government", 1.192],
  ["health", 1.127], ["religion", 1.045], ["trade", 1.01], ["parliament", 0.99],
  ["population", 0.961], ["housing", 0.949], ["other", 0.926], ["environment", 0.876],
  ["culture", 0.873], ["defence", 0.867], ["science", 0.853], ["international", 0.85],
];

function polygonArea(poly) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(area) / 2;
}

function polygonCentroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    x += (poly[j][0] + poly[i][0]) * f;
    y += (poly[j][1] + poly[i][1]) * f;
    a += f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-6) {
    const sx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const sy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return { x: sx, y: sy };
  }
  return { x: x / (6 * a), y: y / (6 * a) };
}

function cleanPolygon(poly) {
  const cleaned = [];
  for (let i = 0; i < poly.length; i += 1) {
    const [x, y] = poly[i];
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.abs(prev[0] - x) < 0.01 && Math.abs(prev[1] - y) < 0.01) continue;
    cleaned.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first[0] - last[0]) < 0.01 && Math.abs(first[1] - last[1]) < 0.01) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function onFrameEdge(x, y, frame, eps = 0.75) {
  return {
    left: Math.abs(x - frame.x) < eps,
    right: Math.abs(x - (frame.x + frame.w)) < eps,
    top: Math.abs(y - frame.y) < eps,
    bottom: Math.abs(y - (frame.y + frame.h)) < eps,
  };
}

function insetPolygon(poly, inset, frame) {
  const c = polygonCentroid(poly);
  return poly.map(([x, y]) => {
    const edge = onFrameEdge(x, y, frame);
    if (edge.left) return [frame.x, y];
    if (edge.right) return [frame.x + frame.w, y];
    if (edge.top) return [x, frame.y];
    if (edge.bottom) return [x, frame.y + frame.h];

    const dx = x - c.x;
    const dy = y - c.y;
    const d = Math.hypot(dx, dy) || 1;
    const shrink = Math.max(0, d - inset);
    return [c.x + (dx / d) * shrink, c.y + (dy / d) * shrink];
  });
}

function squarify(items, x, y, w, h) {
  const rects = [];
  let row = [];
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;
  let remaining = [...items];

  function worstAspect(rowItems, length) {
    if (!rowItems.length) return Infinity;
    const sum = rowItems.reduce((s, item) => s + item.weight, 0);
    let min = Infinity;
    let max = 0;
    rowItems.forEach((item) => {
      const side = (item.weight / sum) * length;
      min = Math.min(min, side);
      max = Math.max(max, side);
    });
    return Math.max((length * length * max) / (sum * sum), (sum * sum) / (length * length * min));
  }

  while (remaining.length) {
    const horizontal = rw >= rh;
    const length = horizontal ? rh : rw;
    const next = remaining[0];
    const candidate = [...row, next];
    if (!row.length || worstAspect(row, length) >= worstAspect(candidate, length)) {
      row.push(next);
      remaining.shift();
    } else {
      const sum = row.reduce((s, item) => s + item.weight, 0);
      row.forEach((item) => {
        const span = (item.weight / sum) * (horizontal ? rw : rh);
        if (horizontal) {
          rects.push({ topic: item.topic, x: rx, y: ry, w: span, h: rh });
          rx += span;
        } else {
          rects.push({ topic: item.topic, x: rx, y: ry, w: rw, h: span });
          ry += span;
        }
      });
      if (horizontal) {
        ry += rh;
        rh = 0;
        rx = x;
      } else {
        rx += rw;
        rw = 0;
        ry = y;
      }
      row = [];
    }
  }

  if (row.length) {
    const sum = row.reduce((s, item) => s + item.weight, 0);
    const horizontal = rw >= rh;
    row.forEach((item) => {
      const span = (item.weight / sum) * (horizontal ? rw : rh);
      if (horizontal) {
        rects.push({ topic: item.topic, x: rx, y: ry, w: span, h: rh });
        rx += span;
      } else {
        rects.push({ topic: item.topic, x: rx, y: ry, w: rw, h: span });
        ry += span;
      }
    });
  }

  return rects;
}

function initSeeds(topicRows, frame) {
  const items = topicRows
    .map(([topic, scale]) => ({ topic, weight: scale * scale }))
    .sort((a, b) => b.weight - a.weight);
  const rects = squarify(items, frame.x, frame.y, frame.w, frame.h);
  const rectsByArea = [...rects].sort((a, b) => b.w * b.h - a.w * a.h);

  const overrides = {
    justice: { x: 130, y: 250 },
    economy: { x: 145, y: 410 },
    land: { x: 280, y: 470 },
    education: { x: 260, y: 140 },
    transport: { x: 500, y: 360 },
  };

  return items.map((item, i) => {
    const rect = rectsByArea[i];
    const h = hashTopic(item.topic);
    const jx = ((h % 13) - 6) / 6 * rect.w * 0.12;
    const jy = (((h / 13) % 13) - 6) / 6 * rect.h * 0.12;
    const base = {
      topic: item.topic,
      x: rect.x + rect.w / 2 + jx,
      y: rect.y + rect.h / 2 + jy,
    };
    const override = overrides[item.topic];
    if (!override) return base;
    return {
      topic: item.topic,
      x: base.x * 0.25 + override.x * 0.75,
      y: base.y * 0.25 + override.y * 0.75,
    };
  });
}

function hashTopic(topic) {
  let h = 0;
  for (let i = 0; i < topic.length; i += 1) h = (h * 31 + topic.charCodeAt(i)) % 997;
  return h;
}

function refineLayout(topicRows, frame, iterations = 16) {
  const seeds = initSeeds(topicRows, frame);
  const topicOrder = seeds.map((seed) => seed.topic);
  const totalWeight = topicRows.reduce((s, [, scale]) => s + scale * scale, 0);
  const targetAreas = Object.fromEntries(
    topicRows.map(([topic, scale]) => [topic, (scale * scale / totalWeight) * frame.w * frame.h])
  );

  let points = seeds.map((s) => [s.x, s.y]);

  for (let iter = 0; iter < iterations; iter += 1) {
    const delaunay = Delaunay.from(points);
    const voronoi = delaunay.voronoi([frame.x, frame.y, frame.x + frame.w, frame.y + frame.h]);

    points = points.map((pt, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return pt;
      const centroid = polygonCentroid(cell);
      const area = polygonArea(cell);
      const target = targetAreas[topicOrder[i]];
      const ratio = target / Math.max(area, 1);
      const pull = Math.min(0.48, Math.abs(1 - ratio) * 0.34);

      let nx = pt[0] * 0.3 + centroid.x * 0.7;
      let ny = pt[1] * 0.3 + centroid.y * 0.7;

      if (area < target) {
        nx += (centroid.x - pt[0]) * pull;
        ny += (centroid.y - pt[1]) * pull;
      } else {
        nx -= (centroid.x - pt[0]) * pull * 0.35;
        ny -= (centroid.y - pt[1]) * pull * 0.35;
      }

      return [
        Math.max(frame.x + 24, Math.min(frame.x + frame.w - 24, nx)),
        Math.max(frame.y + 24, Math.min(frame.y + frame.h - 24, ny)),
      ];
    });
  }

  const delaunay = Delaunay.from(points);
  const voronoi = delaunay.voronoi([frame.x, frame.y, frame.x + frame.w, frame.y + frame.h]);
  const layout = {};

  topicOrder.forEach((topic, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return;
    const polygon = cleanPolygon(cell);
    const centroid = polygonCentroid(polygon);
    layout[topic] = {
      polygon,
      x: Math.round(centroid.x * 10) / 10,
      y: Math.round(centroid.y * 10) / 10,
      area: Math.round(polygonArea(polygon)),
    };
  });

  return layout;
}

function buildLayout(topicRows, frame) {
  return refineLayout(topicRows, frame);
}

const layout = buildLayout(topics, FRAME);
const output = { FRAME, GAP, layout };
fs.writeFileSync(new URL("./data/glass-layout.json", import.meta.url), JSON.stringify(output, null, 2));

const totalWeight = topics.reduce((s, [, scale]) => s + scale * scale, 0);
console.log("topics", Object.keys(layout).length);
topics.forEach(([id, scale]) => {
  const target = (scale * scale / totalWeight) * FRAME.w * FRAME.h;
  const area = layout[id]?.area || 0;
  console.log(id, "area", area, "target", Math.round(target), "ratio", (area / target).toFixed(2));
});
