// A plan, cut into the pieces the model is allowed to point at.
//
// This exists so the model's *reply* can only ever be a step number, and a
// number outside this list is dropped — so it cannot attribute a block to a
// sentence the user did not write. That property is worth more than a clever
// split, which is why this is deliberately dull: headings, list items and
// paragraphs, and nothing that needs a markdown parser.

const MAX_STEPS = 60;
const MAX_STEP_CHARS = 600;

const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;
const NUMBERED_HEADING = /^ {0,3}(#{1,6})\s+(\d+)[.)]\s+(.*)$/;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

/** Where an opening fence that nothing ever closes sits, if there is one.
    Read as ordinary text rather than as a fence: the lines after a stray ```
    are still the user's plan, and reading them as steps beats collapsing the
    whole remainder into one 600-character blob. Only the last unmatched
    opener can be stray, so one pass settles it. */
function strayFence(lines) {
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(FENCE);
    if (!f) continue;
    if (open && f[1][0] === open.marker[0]) open = null;
    else if (!open) open = { marker: f[1], line: i };
  }
  return open ? open.line : -1;
}

function splitNumberedSections(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => NUMBERED_HEADING.test(line))) return null;

  const sections = [];
  let current = null;

  for (const line of lines) {
    const numbered = line.match(NUMBERED_HEADING);
    const heading = line.match(HEADING);
    if (numbered) {
      if (current) sections.push(current);
      current = { depth: numbered[1].length, lines: [numbered[3].trim()] };
      continue;
    }
    if (current && heading && line.match(/^ {0,3}(#{1,6})/)?.[1].length <= current.depth) {
      sections.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push(line.trim());
  }

  if (current) sections.push(current);
  return sections
    .map(({ lines }) => lines.join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((text) => text.slice(0, MAX_STEP_CHARS));
}

function splitAll(markdown) {
  const numberedSections = splitNumberedSections(markdown);
  if (numberedSections) return numberedSections;

  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const steps = [];
  const stray = strayFence(lines);
  let current = null;
  let fence = null;

  /* A heading opens the step that follows it rather than standing as one.
     On its own it was guaranteed noise — "Context" is a one-word step that
     cannot change any block, so every heading in a plan added a step that
     could only ever be counted as idle. That inflated the step count and,
     worse, inflated the denominator of the idle ratio, which is the one
     number this feature reports about a plan.

     Held rather than dropped, because a heading is sometimes the instruction
     itself — "### Task 1: Add the rate limiter" carries the whole ask, and
     the lines under it only elaborate. A heading with nothing after it is
     discarded when the next one arrives, which is the section-label case. */
  let pendingHead = null;

  const flush = () => {
    if (!current) return;
    const body = current.join(" ").replace(/\s+/g, " ").trim();
    current = null;
    if (!body) return;
    const text = pendingHead ? pendingHead + " — " + body : body;
    pendingHead = null;
    steps.push(text.slice(0, MAX_STEP_CHARS));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;

    const f = i === stray ? null : line.match(FENCE);
    if (f) {
      // Inside a fence nothing starts or ends a step. A closing fence has to
      // match the marker that opened it: ~~~ exists precisely so a block can
      // hold ```, and a plan quoting a fenced example is the common case, so
      // closing on the wrong marker would cut it in half.
      if (fence && f[1][0] === fence[0]) fence = null;
      else if (!fence) fence = f[1];
      (current ||= []).push(line.trim());
      continue;
    }
    if (fence) { (current ||= []).push(line.trim()); continue; }

    if (!line.trim()) {
      // Blank lines separate steps, unless the next line is a fence that
      // should ride along with the current step.
      if (!nextLine || !nextLine.trim() || !nextLine.match(FENCE) || i + 1 === stray) {
        flush();
      }
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) { flush(); pendingHead = heading[1].trim() || null; continue; }

    const item = line.match(ITEM);
    if (item) { flush(); current = [item[2]]; continue; }

    // Anything else continues whatever is open, or opens a paragraph.
    (current ||= []).push(line.trim());
  }
  flush();

  return steps;
}

export function splitSteps(markdown) {
  return splitAll(markdown).slice(0, MAX_STEPS).map((text, i) => ({ n: i + 1, text }));
}

/** How many steps the plan really has. The cap above is a bound on the
    prompt, not a claim about the document — and a review that silently sees
    the first sixth of a plan while printing scope sections that read as whole
    coverage is this feature's worst failure. Somebody has to be able to say
    so, and saying so needs the real number. */
export function stepCount(markdown) {
  return splitAll(markdown).length;
}
