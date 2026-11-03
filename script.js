/**
 * Topics visualisation — routing and data unchanged; museum-quality interface.
 * Data: data/topics.csv, data/topic_documents.csv
 */
(function () {
  "use strict";

  const TOPICS_URL = "data/topics.csv";
  const DOCUMENTS_URL = "data/topic_documents.csv";
  const GLASS_LAYOUT_URL = "data/glass-layout.json";
  const GLASS_GAP = "1cm";
  const LABEL_TOPIC_MIN = {
    environment: 15,
    international: 15,
  };
  const LABEL_TOPIC_BOOST = {
    environment: 1.55,
    international: 1.55,
  };
  const LABEL_TOPIC_ADJUST = {
    environment: -2,
  };
  const PUBLICATIONS_PER_TOPIC = 18;
  const MAP_WIDTH = 980;
  const MAP_HEIGHT = 560;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HOVER_BODY_SCALE = 1.14;

  const ANIMATION = {
    justice: { duration: 5.4, delay: 0 },
    economy: { duration: 4.8, delay: -0.9 },
    land: { duration: 5.8, delay: -1.6 },
    education: { duration: 4.5, delay: -2.2 },
    transport: { duration: 5.1, delay: -0.4 },
    welfare: { duration: 4.7, delay: -3.1 },
    agriculture: { duration: 5.6, delay: -1.2 },
    government: { duration: 4.9, delay: -2.7 },
    health: { duration: 5.3, delay: -0.6 },
    religion: { duration: 4.4, delay: -3.8 },
    trade: { duration: 5.0, delay: -1.9 },
    parliament: { duration: 4.6, delay: -2.5 },
    population: { duration: 5.5, delay: -0.3 },
    housing: { duration: 4.3, delay: -3.4 },
    other: { duration: 5.2, delay: -1.1 },
    culture: { duration: 4.8, delay: -2.9 },
    defence: { duration: 5.7, delay: -0.7 },
    environment: { duration: 4.2, delay: -3.6 },
    science: { duration: 5.9, delay: -1.4 },
    international: { duration: 4.1, delay: -2.0 },
  };

  const homeScreen = document.getElementById("home-screen");
  const detailScreen = document.getElementById("detail-screen");
  const topicLayer = document.getElementById("topic-layer");
  const loadError = document.getElementById("load-error");
  const backBtn = document.getElementById("back-btn");
  const detailName = document.getElementById("detail-name");
  const detailSwatch = document.getElementById("detail-swatch");
  const detailCount = document.getElementById("detail-count");
  const detailFirstYear = document.getElementById("detail-first-year");
  const detailLastYear = document.getElementById("detail-last-year");
  const detailDescription = document.getElementById("detail-description");
  const timelineMain = document.getElementById("timeline-main");
  const timelineTip = document.getElementById("timeline-tip");
  const detailPublications = document.getElementById("detail-publications");

  let topics = [];
  let documentsByTopic = new Map();
  let decadeColumns = [];
  let currentTopic = null;
  let filterDecade = null;
  let hoverDecade = null;
  let layoutPositions = {};
  let hoverLeaveTimer = null;

  init();

  async function init() {
    if (window.location.protocol === "file:") {
      loadError.hidden = false;
      loadError.textContent =
        "Cannot load data from a file URL. Run: npx serve — then open http://localhost:3000";
      return;
    }

    try {
      const [topicsText, docsText, glassText] = await Promise.all([
        fetch(TOPICS_URL).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${TOPICS_URL}`);
          return r.text();
        }),
        fetch(DOCUMENTS_URL).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${DOCUMENTS_URL}`);
          return r.text();
        }),
        fetch(GLASS_LAYOUT_URL).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${GLASS_LAYOUT_URL}`);
          return r.text();
        }),
      ]);

      topics = parseCsv(topicsText);
      decadeColumns = buildDecadeColumns(topics[0]);
      indexDocuments(parseCsv(docsText));
      layoutPositions = JSON.parse(glassText).layout || {};
      validateTopics();
      bindEvents();
      routeFromLocation();
      if (!detailScreen.classList.contains("is-active")) {
        renderHome();
      }
    } catch (err) {
      loadError.hidden = false;
      loadError.textContent =
        "Could not load data. Serve this folder over HTTP (e.g. npx serve). " + err.message;
      console.error(err);
    }
  }

  function bindEvents() {
    backBtn.addEventListener("click", () => showHome());
    window.addEventListener("popstate", routeFromLocation);
    window.addEventListener("hashchange", routeFromLocation);
  }

  function validateTopics() {
    const errors = [];
    for (const topic of topics) {
      const layout = layoutPositions[topic.topic];
      if (!layout?.polygon?.length) errors.push(`layout:${topic.topic}`);
      if (!ANIMATION[topic.topic]) errors.push(`animation:${topic.topic}`);
    }
    if (errors.length) {
      console.error("Topic validation failed:", errors);
      loadError.hidden = false;
      loadError.textContent = `Topic map error: ${errors.join(", ")}`;
    }
  }

  function navigateToTopic(topicId) {
    openTopic(topicId);
    const target = `#${topicId}`;
    if (window.location.hash !== target) {
      history.replaceState(null, "", window.location.pathname + window.location.search + target);
    }
  }

  function routeFromLocation() {
    const hash = window.location.hash.replace("#", "");
    if (hash && topics.some((t) => t.topic === hash)) {
      openTopic(hash);
    } else {
      openHome();
    }
  }

  function onTopicLinkPointerDown(event) {
    if (event.button !== 0) return;
    if (hoverLeaveTimer) {
      clearTimeout(hoverLeaveTimer);
      hoverLeaveTimer = null;
    }
    const topicId = event.currentTarget.getAttribute("href").replace("#", "");
    if (topicId) navigateToTopic(topicId);
  }

  function setGroupHoverScale(group, hovered) {
    if (!group) return;
    const cx = group.dataset.cx;
    const cy = group.dataset.cy;
    if (!cx || !cy) return;
    group.setAttribute(
      "transform",
      hovered
        ? `translate(${cx}, ${cy}) scale(${HOVER_BODY_SCALE})`
        : `translate(${cx}, ${cy})`
    );
  }

  function clearTopicHover() {
    if (hoverLeaveTimer) {
      clearTimeout(hoverLeaveTimer);
      hoverLeaveTimer = null;
    }
    if (!topicLayer) return;
    topicLayer.querySelectorAll(".topic-group.is-hovered").forEach((group) => {
      group.classList.remove("is-hovered");
      setGroupHoverScale(group, false);
    });
  }

  function onTopicLinkEnter(link, group) {
    if (hoverLeaveTimer) {
      clearTimeout(hoverLeaveTimer);
      hoverLeaveTimer = null;
    }
    clearTopicHover();
    group.classList.add("is-hovered");
    setGroupHoverScale(group, true);
    if (link.parentNode === topicLayer) {
      requestAnimationFrame(() => {
        if (group.classList.contains("is-hovered") && link.parentNode === topicLayer) {
          topicLayer.appendChild(link);
        }
      });
    }
  }

  function onTopicGroupLeave(group) {
    if (hoverLeaveTimer) clearTimeout(hoverLeaveTimer);
    hoverLeaveTimer = setTimeout(() => {
      group.classList.remove("is-hovered");
      setGroupHoverScale(group, false);
      hoverLeaveTimer = null;
    }, 250);
  }

  function bindTopicMapHover() {
    const map = document.querySelector(".home-map");
    if (!map || map.dataset.hoverBound) return;
    map.dataset.hoverBound = "true";
    map.addEventListener("mouseleave", () => clearTopicHover());
  }

  function openHome() {
    homeScreen.hidden = false;
    homeScreen.classList.add("is-active");
    detailScreen.hidden = true;
    detailScreen.classList.remove("is-active");
    currentTopic = null;
    filterDecade = null;
    hoverDecade = null;
    clearTopicHover();
    if (!topicLayer.querySelector(".topic-group")) {
      renderHome();
    }
  }

  function showHome() {
    openHome();
    const base = window.location.pathname + window.location.search;
    if (window.location.hash) {
      history.replaceState(null, "", base);
    }
  }

  function openTopic(topicId) {
    const topic = topics.find((t) => t.topic === topicId);
    if (!topic) return;
    renderDetail(topic);
    detailScreen.hidden = false;
    detailScreen.classList.add("is-active");
    homeScreen.hidden = true;
    homeScreen.classList.remove("is-active");
  }

  function getTopicArea(topic) {
    return layoutPositions[topic.topic]?.area || 0;
  }

  /* ----- Homepage polygons ----- */

  function renderHome() {
    if (!topicLayer) return;
    topicLayer.replaceChildren();

    const svg = document.getElementById("topic-map");
    const sorted = [...topics].sort((a, b) => getTopicArea(a) - getTopicArea(b));

    for (const topic of sorted) {
      const layout = layoutPositions[topic.topic];
      const anim = ANIMATION[topic.topic];
      if (!layout?.polygon?.length || !anim) continue;

      try {
        const cx = layout.x;
        const cy = layout.y;
        const points = polygonToPoints(layout.polygon, cx, cy);

        const link = document.createElementNS(SVG_NS, "a");
        link.classList.add("topic-link");
        link.setAttribute("href", `#${topic.topic}`);
        link.setAttribute("aria-label", `Open ${topic.display_name}`);

        const group = document.createElementNS(SVG_NS, "g");
        group.classList.add("topic-group");
        group.setAttribute("data-topic", topic.topic);
        group.dataset.cx = String(cx);
        group.dataset.cy = String(cy);
        group.setAttribute("transform", `translate(${cx}, ${cy})`);

        const body = document.createElementNS(SVG_NS, "g");
        body.classList.add("topic-body");

        const glow = document.createElementNS(SVG_NS, "polygon");
        glow.classList.add("topic-glow");
        glow.setAttribute("points", points);
        glow.setAttribute("fill", topic.colour);
        glow.setAttribute("stroke", "#080808");
        glow.setAttribute("stroke-width", GLASS_GAP);
        glow.setAttribute("stroke-linejoin", "miter");
        glow.setAttribute("stroke-miterlimit", "2.5");
        glow.setAttribute("paint-order", "stroke fill");
        glow.setAttribute("opacity", "0.35");
        glow.setAttribute("pointer-events", "none");

        const polygon = document.createElementNS(SVG_NS, "polygon");
        polygon.classList.add("topic-polygon");
        polygon.setAttribute("points", points);
        polygon.setAttribute("fill", topic.colour);
        polygon.setAttribute("stroke", "#080808");
        polygon.setAttribute("stroke-width", GLASS_GAP);
        polygon.setAttribute("stroke-linejoin", "miter");
        polygon.setAttribute("stroke-miterlimit", "2.5");
        polygon.setAttribute("paint-order", "stroke fill");

        const localPoly = layout.polygon.map(([x, y]) => [x - cx, y - cy]);
        const labelLayout = resolveLabelLayout(
          localPoly,
          topic.display_name,
          layout.area,
          svg,
          topic.topic
        );
        const label = document.createElementNS(SVG_NS, "text");
        label.classList.add("topic-label");
        label.setAttribute("x", String(labelLayout.x));
        label.setAttribute("y", String(labelLayout.y));
        const labelSize = Math.max(
          LABEL_TOPIC_MIN[topic.topic] || 7,
          labelLayout.size + (LABEL_TOPIC_ADJUST[topic.topic] || 0)
        );
        label.setAttribute("font-size", `${labelSize}px`);
        label.textContent = topic.display_name;

        body.appendChild(glow);
        body.appendChild(polygon);
        body.appendChild(label);
        group.appendChild(body);
        link.appendChild(group);
        link.addEventListener("pointerdown", onTopicLinkPointerDown);
        link.addEventListener("mouseenter", () => onTopicLinkEnter(link, group));
        link.addEventListener("mouseleave", () => onTopicGroupLeave(group));
        topicLayer.appendChild(link);
      } catch (err) {
        console.error(`Failed to render topic polygon: ${topic.topic}`, err);
      }
    }

    bindTopicMapHover();
  }

  function getBaseLabelSize(area, topicId) {
    const doubled = Math.max(20, Math.min(36, Math.sqrt(area) * 0.084));
    let base = doubled * 0.85;
    const boost = LABEL_TOPIC_BOOST[topicId] || 1;
    base *= boost;
    return Math.min(36, base);
  }

  function getSvgUserScale(svg) {
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return 1;
    const vb = svg.viewBox.baseVal;
    return vb.width / rect.width;
  }

  function measureLabelBox(text, fontSize, svg) {
    const scale = getSvgUserScale(svg);
    if (!measureLabelBox.canvas) {
      measureLabelBox.canvas = document.createElement("canvas");
    }
    const ctx = measureLabelBox.canvas.getContext("2d");
    ctx.font = `500 ${fontSize}px Inter, sans-serif`;
    const metrics = ctx.measureText(text);
    return {
      width: metrics.width * scale,
      height: fontSize * 1.15 * scale,
    };
  }

  function gatherLabelAnchorCandidates(localPoly) {
    const candidates = [];
    const bounds = polygonBounds(localPoly);
    const points = [
      { x: 0, y: 0 },
      { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.5 },
      { x: bounds.x + bounds.w * 0.3, y: bounds.y + bounds.h * 0.35 },
      { x: bounds.x + bounds.w * 0.7, y: bounds.y + bounds.h * 0.35 },
      { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.65 },
    ];

    for (const point of points) {
      if (pointInPolygon(point.x, point.y, localPoly)) {
        candidates.push(point);
      }
    }

    if (!candidates.length) {
      candidates.push(polygonInteriorPoint(localPoly));
    }

    return candidates;
  }

  function labelFitsPolygon(localPoly, bbox, padding, anchor) {
    const halfW = bbox.width / 2 + padding;
    const halfH = bbox.height / 2 + padding;
    const samples = [
      [anchor.x, anchor.y],
      [anchor.x - halfW, anchor.y - halfH],
      [anchor.x + halfW, anchor.y - halfH],
      [anchor.x + halfW, anchor.y + halfH],
      [anchor.x - halfW, anchor.y + halfH],
      [anchor.x, anchor.y - halfH],
      [anchor.x, anchor.y + halfH],
      [anchor.x - halfW, anchor.y],
      [anchor.x + halfW, anchor.y],
    ];
    return samples.every(([x, y]) => pointInPolygon(x, y, localPoly));
  }

  function maxFitLabelSize(localPoly, text, maxSize, minSize, svg, anchor) {
    const padding = 4;
    for (let size = Math.floor(maxSize); size >= minSize; size -= 1) {
      const bbox = measureLabelBox(text, size, svg);
      if (labelFitsPolygon(localPoly, bbox, padding, anchor)) {
        return size;
      }
    }
    return minSize;
  }

  function resolveLabelLayout(localPoly, text, area, svg, topicId) {
    const minSize = LABEL_TOPIC_MIN[topicId] || 7;
    const maxSize = getBaseLabelSize(area, topicId);
    const candidates = gatherLabelAnchorCandidates(localPoly);

    let best = { size: minSize, x: candidates[0].x, y: candidates[0].y };
    for (const anchor of candidates) {
      const size = maxFitLabelSize(localPoly, text, maxSize, minSize, svg, anchor);
      if (size > best.size) {
        best = { size, x: anchor.x, y: anchor.y };
      }
    }

    return best;
  }

  function polygonInteriorPoint(localPoly) {
    if (pointInPolygon(0, 0, localPoly)) return { x: 0, y: 0 };

    const bounds = polygonBounds(localPoly);
    const midX = bounds.x + bounds.w / 2;
    const midY = bounds.y + bounds.h / 2;
    if (pointInPolygon(midX, midY, localPoly)) return { x: midX, y: midY };

    for (let row = 1; row < 8; row += 1) {
      for (let col = 1; col < 8; col += 1) {
        const x = bounds.x + (bounds.w * col) / 8;
        const y = bounds.y + (bounds.h * row) / 8;
        if (pointInPolygon(x, y, localPoly)) return { x, y };
      }
    }

    return { x: 0, y: 0 };
  }

  function polygonToPoints(polygon, cx, cy) {
    return polygon.map(([x, y]) => `${x - cx},${y - cy}`).join(" ");
  }

  function polygonBounds(polygon) {
    const xs = polygon.map(([x]) => x);
    const ys = polygon.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function pointInPolygon(x, y, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];
      const intersects = yi > y !== yj > y
        && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0000001) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  /* ----- Topic page ----- */

  function renderDetail(topic) {
    currentTopic = topic;
    filterDecade = null;
    hoverDecade = null;

    detailName.textContent = topic.display_name;
    detailSwatch.style.backgroundColor = topic.colour;
    detailCount.textContent = formatNum(topic.total_publications);
    detailFirstYear.textContent = topic.first_year;
    detailLastYear.textContent = topic.last_year;
    detailDescription.textContent = topic.description || "";
    detailDescription.hidden = !topic.description;

    renderTimelines(topic);
    renderPublications(topic.topic);
    updateTimelineTip();
  }

  function getDecadeData(topic) {
    return decadeColumns.map((decade) => ({
      decade,
      value: Number(topic[decade]) || 0,
      start: parseInt(decade, 10),
    }));
  }

  function renderTimelines(topic) {
    const main = buildChart(topic, { width: 720, height: 420, margin: { t: 28, r: 24, b: 48, l: 52 }, compact: false });

    timelineMain.innerHTML = main.markup;
    bindTimelineEvents(timelineMain, main.zones, topic);
  }

  function buildChart(topic, opts) {
    const data = getDecadeData(topic);
    const max = Math.max(...data.map((d) => d.value), 1);
    const innerW = opts.width - opts.margin.l - opts.margin.r;
    const innerH = opts.height - opts.margin.t - opts.margin.b;
    const step = innerW / data.length;
    const baseline = opts.margin.t + innerH;

    const points = data.map((d, i) => ({
      x: opts.margin.l + i * step + step / 2,
      y: baseline - (d.value / max) * innerH,
      ...d,
    }));

    const areaPath = buildAreaPath(points, baseline);
    const linePath = buildLinePath(points);

    const zones = [];
    let markup = `<rect width="${opts.width}" height="${opts.height}" fill="#080808"></rect>`;

    data.forEach((d, i) => {
      const x = opts.margin.l + i * step;
      const zoneId = `z-${d.decade}`;
      zones.push({ decade: d.decade, value: d.value, x, width: step });
      markup += `<line class="chart-grid" x1="${x}" y1="${opts.margin.t}" x2="${x}" y2="${baseline}"></line>`;
    });

    markup += `<line class="chart-axis" x1="${opts.margin.l}" y1="${baseline}" x2="${opts.width - opts.margin.r}" y2="${baseline}"></line>`;
    markup += `<path class="chart-area" d="${areaPath}" fill="${topic.colour}"></path>`;
    markup += `<path class="chart-line" d="${linePath}" fill="none" stroke="${topic.colour}" stroke-width="1.5"></path>`;

    data.forEach((d, i) => {
      const x = opts.margin.l + i * step;
      markup += `<rect class="decade-zone" data-decade="${d.decade}" x="${x}" y="${opts.margin.t}" width="${step}" height="${innerH}"></rect>`;
    });

    if (!opts.compact) {
      data.filter((_, i) => i % 3 === 0).forEach((d, idx) => {
        const i = idx * 3;
        const x = opts.margin.l + i * step + step / 2;
        markup += `<text class="chart-label" x="${x}" y="${opts.height - 12}" text-anchor="middle">${d.decade}</text>`;
      });
      markup += `<text class="chart-label" x="${opts.margin.l - 6}" y="${baseline + 2}" text-anchor="end">0</text>`;
      markup += `<text class="chart-label" x="${opts.margin.l - 6}" y="${opts.margin.t + 4}" text-anchor="end">${formatNum(max)}</text>`;
    }

    return { markup, zones };
  }

  function bindTimelineEvents(svgEl, zones, topic) {
    zones.forEach((z) => {
      const el = svgEl.querySelector(`[data-decade="${z.decade}"]`);
      if (!el) return;

      el.addEventListener("mouseenter", () => {
        hoverDecade = z.decade;
        highlightDecades();
        updateTimelineTip();
        renderPublications(topic.topic);
      });

      el.addEventListener("mouseleave", () => {
        if (!filterDecade) {
          hoverDecade = null;
          highlightDecades();
          updateTimelineTip();
          renderPublications(topic.topic);
        }
      });

      el.addEventListener("click", () => {
        filterDecade = filterDecade === z.decade ? null : z.decade;
        hoverDecade = null;
        highlightDecades();
        updateTimelineTip();
        renderPublications(topic.topic);
      });

      el.addEventListener("dblclick", (e) => {
        e.preventDefault();
        filterDecade = null;
        hoverDecade = null;
        highlightDecades();
        updateTimelineTip();
        renderPublications(topic.topic);
      });
    });
  }

  function highlightDecades() {
    const active = filterDecade || hoverDecade;
    document.querySelectorAll(".decade-zone").forEach((el) => {
      el.classList.remove("is-hover", "is-active");
      const decade = el.dataset.decade;
      if (filterDecade && decade === filterDecade) el.classList.add("is-active");
      else if (hoverDecade && decade === hoverDecade) el.classList.add("is-hover");
    });
    if (!active) return;
  }

  function updateTimelineTip() {
    if (!currentTopic) {
      timelineTip.textContent = "";
      return;
    }
    const decade = filterDecade || hoverDecade;
    if (!decade) {
      timelineTip.textContent = "Hover a decade · click to filter · double-click to reset";
      return;
    }
    const count = Number(currentTopic[decade]) || 0;
    timelineTip.textContent = `${decade} · ${formatNum(count)} publications`;
  }

  function docInDecade(doc, decade) {
    const y = parseInt(doc.year, 10);
    if (Number.isNaN(y)) return false;
    const start = parseInt(decade, 10);
    return y >= start && y < start + 10;
  }

  function renderPublications(topicId) {
    const docs = documentsByTopic.get(topicId) || [];
    const decade = filterDecade || hoverDecade;
    const filtered = decade ? docs.filter((d) => docInDecade(d, decade)) : docs;

    detailPublications.replaceChildren();

    if (filtered.length === 0) {
      const p = document.createElement("p");
      p.className = "pub-empty";
      p.textContent = decade ? "No publications in this decade." : "No publications available.";
      detailPublications.appendChild(p);
      return;
    }

    for (const doc of filtered.slice(0, PUBLICATIONS_PER_TOPIC)) {
      const card = document.createElement("article");
      card.className = "pub-card";

      const year = document.createElement("span");
      year.className = "pub-card-year";
      year.textContent = doc.year || "—";

      const title = document.createElement("a");
      title.className = "pub-card-title";
      title.textContent = doc.title;
      if (doc.uri) {
        title.href = doc.uri;
        title.target = "_blank";
        title.rel = "noopener";
      } else {
        title.href = "#";
        title.addEventListener("click", (e) => e.preventDefault());
      }

      const dept = document.createElement("span");
      dept.className = "pub-card-dept";
      dept.textContent = doc.department || doc.region || "—";

      card.appendChild(year);
      card.appendChild(title);
      card.appendChild(dept);
      detailPublications.appendChild(card);
    }
  }

  function buildLinePath(points) {
    if (!points.length) return "";
    return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
  }

  function buildAreaPath(points, baseline) {
    if (points.length < 2) return "";
    const last = points[points.length - 1];
    let d = `M ${points[0].x} ${baseline} L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    d += ` L ${last.x} ${baseline} Z`;
    return d;
  }

  function indexDocuments(rows) {
    documentsByTopic = new Map();
    for (const row of rows) {
      const list = documentsByTopic.get(row.topic) || [];
      list.push(row);
      documentsByTopic.set(row.topic, list);
    }
  }

  function buildDecadeColumns(sampleRow) {
    if (!sampleRow) return [];
    return Object.keys(sampleRow).filter((k) => /^\d{4}s$/.test(k)).sort();
  }

  function formatNum(value) {
    return Number(value).toLocaleString();
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", i = 0, inQuotes = false;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += ch; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift();
    return rows.filter((r) => r.some((c) => c.trim())).map((cells) => {
      const o = {}; header.forEach((k, idx) => o[k] = cells[idx] ?? ""); return o;
    });
  }
})();
