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

function splitAll(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const steps = [];
  const stray = strayFence(lines);
  let current = null;
  let fence = null;

  const flush = () => {
    if (!current) return;
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    if (text) steps.push(text.slice(0, MAX_STEP_CHARS));
    current = null;
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
    if (heading) { flush(); current = [heading[1]]; flush(); continue; }

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
