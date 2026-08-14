const DEFAULTS = { col: 250, row: 138, perRow: 4, maxCols: 5 };

/* Where the blocks go, from what uses what.

   Column is dependency depth. Cycle-closing edges stay visible but do not
   participate in depth, and a barycentre pass pulls peers toward the blocks
   that feed them. Wide graphs wrap into a lower band; graphs with no internal
   order use a compact grid. */
export function layeredPositions(ids, edges, options = {}) {
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
  links.forEach((edge) => feeders.get(edge.to).push(edge.from));
  const rowOf = new Map();
  const barycentre = (id) => {
    const known = feeders.get(id).filter((feeder) => rowOf.has(feeder));
    if (!known.length) return Number.MAX_SAFE_INTEGER;
    return known.reduce((sum, feeder) => sum + rowOf.get(feeder), 0) / known.length;
  };
  columns.forEach((column, index) => {
    if (index > 0) column.sort((a, b) => barycentre(a) - barycentre(b));
    column.forEach((id, row) => rowOf.set(id, row));
  });

  const positions = new Map();
  let bandTop = 0;
  for (let start = 0; start < columns.length; start += maxCols) {
    const band = columns.slice(start, start + maxCols);
    const tallest = band.reduce((max, column) => Math.max(max, column.length), 0);
    band.forEach((column, index) => {
      const offset = (tallest - column.length) / 2;
      column.forEach((id, row) => {
        positions.set(id, {
          x: index * colGap,
          y: Math.round((bandTop + offset + row) * rowGap),
        });
      });
    });
    bandTop += tallest;
  }
  return positions;
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
