const DEFAULTS = { col: 250, row: 138, perRow: 4, maxCols: 3 };

const nodeId = (node) => typeof node === "string" ? node : node && node.id;

/* One layout entry point for both a blank sheet and additions to an existing
   one. `fullPositions` is the common layered seed; incremental placement is
   added below so the wrappers and the browser cannot drift into separate
   notions of what a graph should look like. */
export function layoutGraph(nodes, edges, options = {}) {
  const specs = nodes.map((node) => {
    const object = typeof node === "string" ? { id: node } : node || {};
    return {
      id: nodeId(object),
      x: object.x,
      y: object.y,
      width: Number.isFinite(object.width) ? object.width : (options.nodeWidth || 198),
      height: Number.isFinite(object.height) ? object.height : (options.nodeHeight || 80),
      fixed: object.fixed === true && Number.isFinite(object.x) && Number.isFinite(object.y),
    };
  }).filter((node) => node.id);
  const ids = specs.map((node) => node.id);
  if (options.mode === "incremental") return incrementalPositions(specs, edges, options);
  return fullPositions(ids, edges, options);
}

/* The browser owns plan state, but not a second layout algorithm. This small
   adapter turns its real nodes and transient drag positions into fixed nodes,
   asks the shared incremental solver once, and returns only proposal ids. */
export function proposalPositions({
  realNodes = [], additions = [], edges = [], moved = new Map(), options = {},
}) {
  const real = realNodes.map((node) => ({ ...node, fixed: true }));
  const proposed = additions.map((addition) => {
    const position = moved.get(addition.id);
    return position
      ? { ...addition, x: position.x, y: position.y, fixed: true }
      : { ...addition };
  });
  const all = layoutGraph([...real, ...proposed], edges, { ...options, mode: "incremental" });
  return new Map(additions.flatMap((addition) => {
    const position = all.get(addition.id);
    return position ? [[addition.id, position]] : [];
  }));
}

const boxesOverlap = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;

const boundsOf = (boxes) => boxes.length ? {
  minX: Math.min(...boxes.map((box) => box.x)),
  minY: Math.min(...boxes.map((box) => box.y)),
  maxX: Math.max(...boxes.map((box) => box.x + box.width)),
  maxY: Math.max(...boxes.map((box) => box.y + box.height)),
} : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

function movableComponents(movable, edges) {
  const ids = new Set(movable.map((node) => node.id));
  const neighbours = new Map(movable.map((node) => [node.id, []]));
  edges.forEach((edge) => {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) return;
    neighbours.get(edge.from).push(edge.to);
    neighbours.get(edge.to).push(edge.from);
  });
  const seen = new Set();
  const byId = new Map(movable.map((node) => [node.id, node]));
  const out = [];
  movable.forEach((node) => {
    if (seen.has(node.id)) return;
    const queue = [node.id];
    const component = [];
    seen.add(node.id);
    while (queue.length) {
      const id = queue.shift();
      component.push(byId.get(id));
      neighbours.get(id).forEach((next) => {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      });
    }
    out.push(component);
  });
  return out;
}

function properIntersection(a, b, c, d) {
  const turn = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = turn(a, b, c), abD = turn(a, b, d);
  const cdA = turn(c, d, a), cdB = turn(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
         ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

function placementScore(positions, specs, edges) {
  const byId = new Map(specs.map((node) => [node.id, node]));
  const center = (id) => {
    const p = positions.get(id), node = byId.get(id);
    return p && node ? { x: p.x + node.width / 2, y: p.y + node.height / 2 } : null;
  };
  const drawn = edges.map((edge) => ({ edge, from: center(edge.from), to: center(edge.to) }))
    .filter((line) => line.from && line.to && line.edge.from !== line.edge.to);
  let crossings = 0, length = 0, backward = 0;
  drawn.forEach((line) => {
    const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y;
    length += dx * dx + dy * dy;
    if (dx < 0) backward += dx * dx;
  });
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j];
      if (a.edge.from === b.edge.from || a.edge.from === b.edge.to ||
          a.edge.to === b.edge.from || a.edge.to === b.edge.to) continue;
      if (properIntersection(a.from, a.to, b.from, b.to)) crossings++;
    }
  }
  const boxes = specs.map((node) => {
    const p = positions.get(node.id);
    return p ? { x: p.x, y: p.y, width: node.width, height: node.height } : null;
  }).filter(Boolean);
  const bounds = boundsOf(boxes);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const aspectPenalty = Math.abs(width / height - 1.6) * 1000;
  return crossings * 1e12 + length + backward * 4 + width * height * 0.01 + aspectPenalty;
}

function incrementalPositions(specs, edges, options) {
  const { col: colGap, row: configuredRow } = { ...DEFAULTS, ...options };
  const here = new Set(specs.map((node) => node.id));
  const all = edges.filter((edge) => here.has(edge.from) && here.has(edge.to) && edge.from !== edge.to);
  const stable = new Map(specs.map((node, index) => [node.id, index]));
  const degree = new Map(specs.map((node) => [node.id, 0]));
  all.forEach((edge) => {
    degree.set(edge.from, degree.get(edge.from) + 1);
    degree.set(edge.to, degree.get(edge.to) + 1);
  });
  const fixed = specs.filter((node) => node.fixed);
  const movable = specs.filter((node) => !node.fixed);
  const fixedIds = new Set(fixed.map((node) => node.id));
  const positions = new Map(fixed.map((node) => [node.id, { x: node.x, y: node.y }]));
  const taken = fixed.map((node) => ({
    id: node.id, x: node.x, y: node.y, width: node.width, height: node.height,
  }));
  const splitComponents = movableComponents(movable, all);
  const isolated = splitComponents.filter((component) =>
    component.length === 1 && degree.get(component[0].id) === 0);
  const components = splitComponents.filter((component) =>
    component.length !== 1 || degree.get(component[0].id) !== 0);
  if (isolated.length) components.push(isolated.flat());
  const componentIds = (component) => new Set(component.map((node) => node.id));
  const fixedNeighbours = (component) => {
    const ids = componentIds(component), found = new Set();
    all.forEach((edge) => {
      if (ids.has(edge.from) && fixedIds.has(edge.to)) found.add(edge.to);
      if (ids.has(edge.to) && fixedIds.has(edge.from)) found.add(edge.from);
    });
    return fixed.filter((node) => found.has(node.id));
  };
  components.sort((a, b) =>
    fixedNeighbours(b).length - fixedNeighbours(a).length ||
    b.reduce((sum, node) => sum + degree.get(node.id), 0) -
      a.reduce((sum, node) => sum + degree.get(node.id), 0) ||
    stable.get(a[0].id) - stable.get(b[0].id));

  components.forEach((component) => {
    const ids = componentIds(component);
    const internal = all.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const rowGap = Math.max(configuredRow || DEFAULTS.row,
      ...component.map((node) => node.height + 30));
    const seed = fullPositions(component.map((node) => node.id), internal, {
      ...options, row: rowGap, maxCols: options.maxCols || DEFAULTS.maxCols,
    });
    const seedBoxes = component.map((node) => {
      const p = seed.get(node.id);
      return { id: node.id, x: p.x, y: p.y, width: node.width, height: node.height };
    });
    const seedBounds = boundsOf(seedBoxes);
    const neighbours = fixedNeighbours(component);
    const occupied = boundsOf(taken);
    const anchorX = neighbours.length
      ? neighbours.reduce((sum, node) => sum + node.x, 0) / neighbours.length
      : occupied.minX;
    const anchorY = neighbours.length
      ? neighbours.reduce((sum, node) => sum + node.y, 0) / neighbours.length
      : taken.length ? occupied.maxY + 30 : 0;
    const anchorWidth = neighbours.length
      ? Math.max(...neighbours.map((node) => node.width)) : 0;
    const anchorHeight = neighbours.length
      ? Math.max(...neighbours.map((node) => node.height)) : 0;
    const seedCenterX = (seedBounds.minX + seedBounds.maxX) / 2;
    const seedCenterY = (seedBounds.minY + seedBounds.maxY) / 2;
    const bases = [];
    if (neighbours.length > 1) bases.push({ x: anchorX - seedCenterX, y: anchorY - seedCenterY });
    if (neighbours.length) {
      bases.push(
        { x: anchorX + anchorWidth + 30 - seedBounds.minX, y: anchorY - seedCenterY },
        { x: anchorX - seedCenterX, y: anchorY + anchorHeight + 30 - seedBounds.minY },
        { x: anchorX - (seedBounds.maxX - seedBounds.minX) - 30, y: anchorY - seedCenterY },
        { x: anchorX - seedCenterX, y: anchorY - (seedBounds.maxY - seedBounds.minY) - 30 },
      );
    }
    bases.push({
      x: occupied.minX - seedBounds.minX,
      y: (taken.length ? occupied.maxY + 30 : 0) - seedBounds.minY,
    });

    const candidates = new Map();
    bases.forEach((base) => {
      for (let dy = -2; dy <= 4; dy++) {
        for (let dx = -2; dx <= 4; dx++) {
          const x = Math.round(base.x + dx * colGap);
          const y = Math.round(base.y + dy * rowGap);
          candidates.set(x + ":" + y, { x, y });
        }
      }
    });
    let best = null;
    candidates.forEach((translation) => {
      const trialBoxes = seedBoxes.map((box) => ({
        ...box, x: box.x + translation.x, y: box.y + translation.y,
      }));
      if (trialBoxes.some((box) => taken.some((claimed) => boxesOverlap(box, claimed)))) return;
      const trial = new Map(positions);
      trialBoxes.forEach((box) => trial.set(box.id, { x: box.x, y: box.y }));
      const preference = Math.min(...bases.map((base) => {
        const dx = translation.x - base.x, dy = translation.y - base.y;
        return dx * dx + dy * dy;
      }));
      const score = placementScore(trial, specs, all) + preference * 0.25;
      if (!best || score < best.score ||
          (score === best.score && (translation.y < best.translation.y ||
            (translation.y === best.translation.y && translation.x < best.translation.x)))) {
        best = { score, translation, boxes: trialBoxes };
      }
    });

    if (!best) {
      const x = occupied.minX - seedBounds.minX;
      let y = occupied.maxY + 30 - seedBounds.minY;
      let boxes;
      do {
        boxes = seedBoxes.map((box) => ({ ...box, x: box.x + x, y: box.y + y }));
        if (boxes.some((box) => taken.some((claimed) => boxesOverlap(box, claimed)))) y += rowGap;
        else break;
      } while (true);
      best = { boxes };
    }
    best.boxes.forEach((box) => {
      positions.set(box.id, { x: box.x, y: box.y });
      taken.push(box);
    });
  });
  return positions;
}

/* Where the blocks go, from what uses what.

   Column is dependency depth. Cycle-closing edges stay visible but do not
   participate in depth, and a barycentre pass pulls peers toward the blocks
   that feed them. Wide graphs wrap into a lower band; graphs with no internal
   order use a compact grid. */
function fullPositions(ids, edges, options = {}) {
  const { col: colGap, row: rowGap, perRow, maxCols } = { ...DEFAULTS, ...options };
  const here = new Set(ids);
  const all = edges.filter((edge) =>
    here.has(edge.from) && here.has(edge.to) && edge.from !== edge.to
  );

  if (!all.length) {
    return new Map(ids.map((id, index) => [id, {
      x: (index % perRow) * colGap,
      y: Math.floor(index / perRow) * rowGap,
    }]));
  }

  const outgoing = new Map(ids.map((id) => [id, []]));
  all.forEach((edge) => outgoing.get(edge.from).push(edge));
  const fed = new Set(all.map((edge) => edge.to));
  const state = new Map();
  const loops = new Set();
  const walk = (id) => {
    state.set(id, 1);
    outgoing.get(id).forEach((edge) => {
      const nextState = state.get(edge.to);
      if (nextState === 1) loops.add(edge);
      else if (nextState === undefined) walk(edge.to);
    });
    state.set(id, 2);
  };
  ids.filter((id) => !fed.has(id)).forEach((id) => {
    if (!state.has(id)) walk(id);
  });
  ids.forEach((id) => {
    if (!state.has(id)) walk(id);
  });
  const links = all.filter((edge) => !loops.has(edge));

  const columnOf = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    links.forEach((edge) => {
      const wanted = columnOf.get(edge.from) + 1;
      if (columnOf.get(edge.to) < wanted) {
        columnOf.set(edge.to, wanted);
        moved = true;
      }
    });
    if (!moved) break;
  }

  const lastColumn = ids.reduce((max, id) => Math.max(max, columnOf.get(id)), 0);
  const columns = [];
  for (let column = 0; column <= lastColumn; column++) {
    columns.push(ids.filter((id) => columnOf.get(id) === column));
  }

  const feeders = new Map(ids.map((id) => [id, []]));
  const degree = new Map(ids.map((id) => [id, 0]));
  const stable = new Map(ids.map((id, index) => [id, index]));
  links.forEach((edge) => feeders.get(edge.to).push(edge.from));
  all.forEach((edge) => {
    degree.set(edge.from, degree.get(edge.from) + 1);
    degree.set(edge.to, degree.get(edge.to) + 1);
  });
  const rowOf = new Map();
  const barycentre = (id) => {
    const known = feeders.get(id).filter((feeder) => rowOf.has(feeder));
    if (!known.length) return Number.MAX_SAFE_INTEGER;
    return known.reduce((sum, feeder) => sum + rowOf.get(feeder), 0) / known.length;
  };
  columns.forEach((column, index) => {
    if (index > 0) column.sort((a, b) =>
      barycentre(a) - barycentre(b) || degree.get(b) - degree.get(a) || stable.get(a) - stable.get(b));
    column.forEach((id, row) => rowOf.set(id, row));
  });

  const positions = new Map();
  let bandTop = 0;
  for (let start = 0; start < columns.length; start += maxCols) {
    const band = columns.slice(start, start + maxCols);
    const reverse = Math.floor(start / maxCols) % 2 === 1;
    const tallest = band.reduce((max, column) => Math.max(max, column.length), 0);
    band.forEach((column, index) => {
      const offset = (tallest - column.length) / 2;
      column.forEach((id, row) => {
        positions.set(id, {
          // Snake alternate bands so the edge that crosses a wrap stays near
          // the last node in the previous band instead of spanning the sheet.
          x: (reverse ? maxCols - 1 - index : index) * colGap,
          y: Math.round((bandTop + offset + row) * rowGap),
        });
      });
    });
    bandTop += tallest;
  }
  return positions;
}

export function layeredPositions(ids, edges, options = {}) {
  return layoutGraph(ids, edges, { ...options, mode: "full" });
}

/* Generation arrives as a paced list of moves, but placement needs the whole
   answer. Extract its graph once so every node can enter at its final spot. */
export function generatedPositions(moves, options) {
  const ids = moves
    .filter((move) => move && move.t === "addNode" && move.node && move.node.id)
    .map((move) => move.node.id);
  const here = new Set(ids);
  const edges = moves.filter((move) =>
    move && move.t === "connect" && here.has(move.from) && here.has(move.to)
  );
  return layeredPositions(ids, edges, options);
}
