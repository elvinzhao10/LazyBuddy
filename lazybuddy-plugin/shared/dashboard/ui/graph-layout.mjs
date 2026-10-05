export class GraphLayoutError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'GraphLayoutError';
    this.code = code;
  }
}

const defaults = Object.freeze({ nodeWidth: 224, nodeHeight: 232, columnGap: 104, rowGap: 32, padding: 32 });

function finitePosition(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

/** Deterministic layered layout for a validated dependency snapshot. */
export function layeredDAGLayout(tasks, positions = {}) {
  if (!Array.isArray(tasks)) throw new GraphLayoutError('TASKS_REQUIRED');
  const byId = new Map();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !Array.isArray(task.depends_on)) throw new GraphLayoutError('INVALID_TASK');
    if (byId.has(task.id)) throw new GraphLayoutError('DUPLICATE_TASK', task.id);
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.depends_on) {
      if (!byId.has(dependency)) throw new GraphLayoutError('UNKNOWN_DEPENDENCY', `${task.id} -> ${dependency}`);
    }
  }
  const active = new Set();
  const layers = new Map();
  function layer(id) {
    if (active.has(id)) throw new GraphLayoutError('DEPENDENCY_CYCLE', id);
    if (layers.has(id)) return layers.get(id);
    active.add(id);
    const task = byId.get(id);
    const value = task.depends_on.length ? 1 + Math.max(...task.depends_on.map(layer)) : 0;
    active.delete(id);
    layers.set(id, value);
    return value;
  }
  for (const id of [...byId.keys()].sort()) layer(id);
  const columns = [];
  for (const id of [...byId.keys()].sort()) {
    const index = layers.get(id);
    if (!columns[index]) columns[index] = [];
    columns[index].push(id);
  }
  const nodes = [];
  for (const [column, ids] of columns.entries()) {
    for (const [row, id] of ids.entries()) {
      const fallback = {
        x: defaults.padding + column * (defaults.nodeWidth + defaults.columnGap),
        y: defaults.padding + row * (defaults.nodeHeight + defaults.rowGap),
      };
      const point = finitePosition(positions[id]) ? positions[id] : fallback;
      nodes.push({ id, layer: column, x: point.x, y: point.y, width: defaults.nodeWidth, height: defaults.nodeHeight });
    }
  }
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges = tasks.flatMap(task => task.depends_on.map(dependency => {
    const source = nodeById.get(dependency);
    const target = nodeById.get(task.id);
    return { id: `${dependency}->${task.id}`, source: dependency, target: task.id,
      x1: source.x + source.width, y1: source.y + source.height / 2,
      x2: target.x, y2: target.y + target.height / 2 };
  })).sort((left, right) => left.id.localeCompare(right.id));
  const width = Math.max(480, ...nodes.map(node => node.x + node.width + defaults.padding));
  const height = Math.max(260, ...nodes.map(node => node.y + node.height + defaults.padding));
  return { nodes, edges, width, height };
}
