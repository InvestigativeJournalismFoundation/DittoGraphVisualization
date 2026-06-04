import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";

// ── palette ──────────────────────────────────────────────────────────────────
const PALETTE = [
  "#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00",
  "#a65628","#f781bf","#17becf","#bcbd22","#2ca02c",
  "#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f",
  "#1f77b4","#aec7e8","#ffbb78","#98df8a","#ff9896",
];

function clusterColor(clusterId) {
  return PALETTE[clusterId % PALETTE.length];
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim(); });
    return obj;
  });
}

// ── load ──────────────────────────────────────────────────────────────────────
async function loadData(name) {
  const base = import.meta.env.BASE_URL + `data/${name}/`;
  const [edgesText, clustersText] = await Promise.all([
    fetch(base + "edges.csv").then(r => r.text()),
    fetch(base + "clusters.csv").then(r => r.text()),
  ]);
  return {
    edges: parseCSV(edgesText),
    clusters: parseCSV(clustersText),
  };
}

// ── build graph ───────────────────────────────────────────────────────────────
function buildGraph(edges, clusters) {
  const graph = new Graph({ multi: false, type: "undirected" });

  const clusterMap = {};
  for (const { name, cluster_id } of clusters) {
    clusterMap[name] = parseInt(cluster_id, 10);
  }

  // Collect all nodes that appear in edges
  const nodeNames = new Set();
  for (const { name1, name2 } of edges) {
    nodeNames.add(name1);
    nodeNames.add(name2);
  }

  // Also include all cluster nodes (isolated nodes get no edges but are in the data)
  for (const { name } of clusters) {
    nodeNames.add(name);
  }

  for (const name of nodeNames) {
    const clusterId = clusterMap[name] ?? -1;
    graph.addNode(name, {
      label: name,
      size: 5,
      color: clusterColor(clusterId === -1 ? 19 : clusterId),
      cluster: clusterId,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
    });
  }

  for (const { name1, name2, score, false_positive } of edges) {
    if (name1 === name2) continue;
    const s = parseFloat(score);
    const isFP = false_positive === "1";
    if (!graph.hasEdge(name1, name2)) {
      graph.addEdge(name1, name2, {
        weight: s,
        falsePositive: isFP,
        size: Math.max(0.5, s * 3),
        color: isFP
          ? `rgba(220,50,50,${Math.max(0.4, s * 0.8)})`
          : `rgba(120,140,180,${Math.max(0.15, s * 0.6)})`,
      });
    }
  }

  return graph;
}

// ── layout ────────────────────────────────────────────────────────────────────
function setMsg(msg) {
  document.getElementById("loading-msg").textContent = msg;
}

function runLayout(graph) {
  graph.nodes().forEach(n => {
    graph.setNodeAttribute(n, "size", 5);
  });

  const settings = forceAtlas2.inferSettings(graph);
  settings.gravity = 0.05;
  settings.scalingRatio = 8;
  settings.strongGravityMode = false;

  forceAtlas2.assign(graph, { iterations: 300, settings });
}

// ── legend ────────────────────────────────────────────────────────────────────
function buildLegend(clusters, sigmaInstance, graph) {
  const counts = {};
  for (const { cluster_id } of clusters) {
    counts[cluster_id] = (counts[cluster_id] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById("legend-items");

  for (const [cid, count] of sorted.slice(0, 30)) {
    const id = parseInt(cid, 10);
    const div = document.createElement("div");
    div.className = "legend-item";
    div.innerHTML = `<div class="legend-dot" style="background:${clusterColor(id)}"></div>
      <span>Cluster ${id} (${count})</span>`;
    div.addEventListener("click", () => highlightCluster(id, sigmaInstance, graph));
    container.appendChild(div);
  }

  if (sorted.length > 30) {
    const more = document.createElement("div");
    more.style.cssText = "font-size:11px;color:#555;padding:4px 4px;";
    more.textContent = `+ ${sorted.length - 30} more clusters`;
    container.appendChild(more);
  }
}

// ── highlight cluster ─────────────────────────────────────────────────────────
function highlightCluster(clusterId, sigmaInstance, graph) {
  sigmaInstance.setSetting("nodeReducer", (node, data) => {
    if (graph.getNodeAttribute(node, "cluster") === clusterId) {
      return { ...data, highlighted: true };
    }
    return { ...data, color: "#222", label: undefined };
  });
  sigmaInstance.setSetting("edgeReducer", (edge, data) => {
    const src = graph.source(edge);
    const tgt = graph.target(edge);
    if (
      graph.getNodeAttribute(src, "cluster") === clusterId &&
      graph.getNodeAttribute(tgt, "cluster") === clusterId
    ) {
      return data;
    }
    return { ...data, color: "#1a1d27" };
  });
}

// ── node info panel ───────────────────────────────────────────────────────────
function showNodeInfo(node, graph, sigmaInstance) {
  const attrs = graph.getNodeAttributes(node);
  const neighbors = graph.neighbors(node).map(n => ({
    name: n,
    score: graph.getEdgeAttribute(graph.edge(node, n), "weight"),
    falsePositive: graph.getEdgeAttribute(graph.edge(node, n), "falsePositive"),
  })).sort((a, b) => b.score - a.score);

  const fpCount = neighbors.filter(n => n.falsePositive).length;

  const panel = document.getElementById("node-info");
  panel.innerHTML = `
    <h3>${node}</h3>
    <div class="info-row"><span class="info-label">Cluster</span><span class="info-value">${attrs.cluster}</span></div>
    <div class="info-row"><span class="info-label">Connections</span><span class="info-value">${neighbors.length}</span></div>
    ${fpCount ? `<div class="info-row"><span class="info-label">False positives</span><span class="info-value" style="color:#e05555">${fpCount}</span></div>` : ""}
    <div class="neighbor-list">
      <h4>Connected orgs</h4>
      ${neighbors.map(nb => `
        <div class="neighbor-item" data-node="${nb.name}" style="${nb.falsePositive ? "border-left:2px solid #e05555;padding-left:6px" : ""}">
          <span>${nb.name}</span>
          <span class="score-badge" style="${nb.falsePositive ? "color:#e05555" : ""}">${nb.score.toFixed(3)}</span>
        </div>`).join("")}
    </div>`;

  panel.querySelectorAll(".neighbor-item").forEach(el => {
    el.addEventListener("click", () => {
      const target = el.dataset.node;
      sigmaInstance.getCamera().animate(
        sigmaInstance.getNodeDisplayData(target),
        { duration: 500 }
      );
      showNodeInfo(target, graph, sigmaInstance);
    });
  });
}

// ── search ────────────────────────────────────────────────────────────────────
function setupSearch(sigmaInstance, graph) {
  const input = document.getElementById("search-input");
  // Replace with a fresh clone to remove any prior event listeners
  const fresh = input.cloneNode(true);
  input.replaceWith(fresh);
  fresh.addEventListener("input", () => {
    const q = fresh.value.trim().toLowerCase();
    if (!q) {
      sigmaInstance.setSetting("nodeReducer", null);
      sigmaInstance.setSetting("edgeReducer", null);
      return;
    }
    const matched = new Set(
      graph.nodes().filter(n => n.toLowerCase().includes(q))
    );
    sigmaInstance.setSetting("nodeReducer", (node, data) => {
      if (matched.has(node)) return { ...data, highlighted: true, size: data.size + 3 };
      return { ...data, color: "#1e2030", label: undefined };
    });
    sigmaInstance.setSetting("edgeReducer", (_, data) => ({ ...data, color: "#1a1d27" }));
  });
}

// ── init graph for a named dataset ───────────────────────────────────────────
let currentRenderer = null;

async function initGraph(name) {
  document.getElementById("loading").style.display = "flex";
  setMsg("Loading data…");
  document.getElementById("header-stats").textContent = "Loading…";
  document.getElementById("legend-items").innerHTML = "";
  document.getElementById("node-info").innerHTML = '<p class="placeholder">Click a node to inspect it.</p>';

  if (currentRenderer) {
    currentRenderer.kill();
    currentRenderer = null;
  }

  const { edges, clusters } = await loadData(name);

  setMsg("Building graph…");
  const graph = buildGraph(edges, clusters);

  setMsg(`Running layout (${graph.order} nodes, ${graph.size} edges)…`);
  await new Promise(r => setTimeout(r, 30));
  runLayout(graph);

  setMsg("Rendering…");
  await new Promise(r => setTimeout(r, 30));

  document.getElementById("header-stats").textContent =
    `${graph.order} organisations · ${graph.size} predicted matches · ${new Set(clusters.map(c => c.cluster_id)).size} clusters`;

  const container = document.getElementById("sigma-container");
  currentRenderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    defaultEdgeColor: "#2a3040",
    labelDensity: 0.07,
    labelGridCellSize: 60,
    labelColor: { color: "#ccc" },
    labelSize: 11,
    minCameraRatio: 0.02,
    maxCameraRatio: 10,
  });

  document.getElementById("loading").style.display = "none";

  buildLegend(clusters, currentRenderer, graph);
  setupSearch(currentRenderer, graph);

  currentRenderer.on("clickNode", ({ node }) => {
    showNodeInfo(node, graph, currentRenderer);

    const neighbors = new Set(graph.neighbors(node));
    currentRenderer.setSetting("nodeReducer", (n, data) => {
      if (n === node) return { ...data, highlighted: true };
      if (neighbors.has(n)) return { ...data, highlighted: true };
      return { ...data, color: "#1e2030", label: undefined };
    });
    currentRenderer.setSetting("edgeReducer", (edge, data) => {
      if (graph.hasExtremity(edge, node)) return data;
      return { ...data, color: "#1a1d27" };
    });
  });

  currentRenderer.on("clickStage", () => {
    currentRenderer.setSetting("nodeReducer", null);
    currentRenderer.setSetting("edgeReducer", null);
    document.getElementById("node-info").innerHTML = '<p class="placeholder">Click a node to inspect it.</p>';
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Zoom controls (wired once, work across dataset switches)
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    currentRenderer?.getCamera().animatedZoom({ duration: 300 });
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    currentRenderer?.getCamera().animatedUnzoom({ duration: 300 });
  });
  document.getElementById("btn-reset").addEventListener("click", () => {
    currentRenderer?.getCamera().animatedReset({ duration: 400 });
  });

  // Load dataset index and populate dropdown
  const datasets = await fetch(import.meta.env.BASE_URL + "data/index.json").then(r => r.json());
  const select = document.getElementById("dataset-select");
  for (const name of datasets) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    initGraph(select.value).catch(err => {
      document.getElementById("loading-msg").textContent = `Error: ${err.message}`;
      console.error(err);
    });
  });

  await initGraph(datasets[0]);
}

main().catch(err => {
  document.getElementById("loading-msg").textContent = `Error: ${err.message}`;
  console.error(err);
});
