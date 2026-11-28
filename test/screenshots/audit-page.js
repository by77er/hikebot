/*
 * The page audit's measurements, run in the page by `auditPage` in
 * `audit.ts`. This file is a classic script, not a module: `audit.ts` reads
 * it and evaluates it through DevTools, outside the page's
 * Content-Security-Policy, so it must stay plain browser JavaScript with
 * no imports, and runs with the page laid out as it was shot.
 *
 * `hikebotAudit(options)` returns the findings of the page as it stands,
 * one `{ check, selector, text, value }` per finding, in document order:
 * `selector` is a CSS selector that matches only the element in this
 * document, `text` a few of its words, `value` what was measured. Options:
 * `targets` (measure touch targets), `smallestText` (the smallest type
 * token, in CSS px), `mainPath` (the selector of the page's primary
 * action) and `shiftLimit` (the layout shift that fails). The layout shift
 * is summed from the document's start by `SHIFT_OBSERVER` in `audit.ts`,
 * installed before the page opens; this reads its sum.
 */
/* exported hikebotAudit */
function hikebotAudit(options) {
  const findings = [];
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const style = (element, pseudo) => getComputedStyle(element, pseudo);

  /** A selector for `element` that matches it alone in the document. */
  const selectorOf = (element) => {
    const parts = [];
    for (
      let node = element;
      node && node.nodeType === 1 && node !== root;
      node = node.parentElement
    ) {
      const tag = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${tag}#${CSS.escape(node.id)}`);
        break;
      }
      let part =
        tag +
        [...node.classList].map((name) => `.${CSS.escape(name)}`).join("");
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter(
          (child) => child.tagName === node.tagName,
        );
        const alike = sameTag.filter((child) => child.matches(part));
        if (alike.length > 1) {
          part += `:nth-of-type(${String(sameTag.indexOf(node) + 1)})`;
        }
      }
      parts.unshift(part);
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
    }
    return parts.join(" > ") || "html";
  };

  /** The first words of what `element` says, to read the report by. */
  const textOf = (element) => {
    const said =
      element.getAttribute("aria-label") ||
      element.textContent ||
      element.getAttribute("value") ||
      element.getAttribute("placeholder") ||
      "";
    const words = said.trim().replace(/\s+/g, " ");
    return words.length > 40 ? `${words.slice(0, 39)}…` : words;
  };

  const report = (check, element, value) => {
    findings.push({
      check,
      selector: selectorOf(element),
      text: textOf(element),
      value,
    });
  };

  const px = (value) => `${String(Math.round(value * 10) / 10)} px`;

  /** Laid out and drawn: not display: none, hidden or in a closed details. */
  const shown = (element) =>
    element.getClientRects().length > 0 &&
    element.checkVisibility({ visibilityProperty: true });

  /** Text no one sees, or that is not laid out as words of the page. */
  const unseen = (element) =>
    element.closest(
      '.u-visually-hidden, .skip-link:not(:focus), [hidden], [aria-hidden="true"], template, script, style, noscript, title, select, option, dialog:not([open])',
    ) !== null;

  /** The nearest ancestor of `node` that is not laid out inline. */
  const blockOf = (node) => {
    let block = node.parentElement;
    while (block && /^(inline|contents)$/.test(style(block).display)) {
      block = block.parentElement;
    }
    return block;
  };

  /**
   * Inside running text: the link's block lays it out inline among words
   * that belong neither to it nor to another control. A flex or grid
   * container lays its children out as items, not as a sentence.
   */
  const inSentence = (element) => {
    const block = blockOf(element);
    if (!block || /flex|grid/.test(style(block).display)) return false;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim() || element.contains(text)) continue;
      const parent = text.parentElement;
      if (parent.closest("a, button, input, select, textarea, label")) {
        continue;
      }
      if (unseen(parent) || blockOf(text) !== block) continue;
      return true;
    }
    return false;
  };

  /** Every visible text node of the page, with its element. */
  const texts = [];
  {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const element = text.parentElement;
      if (!element || !text.textContent.trim()) continue;
      if (unseen(element) || !shown(element)) continue;
      texts.push({ text, element });
    }
  }

  /** The words of a text node, each with the boxes it is drawn in. */
  const wordsOf = (text) => {
    const words = [];
    const range = document.createRange();
    const pattern = /\S+/g;
    for (
      let match = pattern.exec(text.textContent);
      match;
      match = pattern.exec(text.textContent)
    ) {
      range.setStart(text, match.index);
      range.setEnd(text, match.index + match[0].length);
      const boxes = [...range.getClientRects()].filter(
        (box) => box.width > 0 && box.height > 0,
      );
      if (boxes.length > 0) words.push({ word: match[0], boxes });
    }
    return words;
  };

  // overflow: the document scrolls sideways.
  const over = root.scrollWidth - viewportWidth;
  if (over > 0) {
    let culprit = root;
    for (const element of document.body.querySelectorAll("*")) {
      if (!shown(element)) continue;
      const box = element.getBoundingClientRect();
      const parent = element.parentElement.getBoundingClientRect();
      if (
        box.right > viewportWidth + 0.5 &&
        parent.right <= viewportWidth + 0.5
      ) {
        culprit = element;
        break;
      }
    }
    report(
      "overflow",
      culprit,
      `the page scrolls sideways by ${px(over)} at ${px(viewportWidth)} wide`,
    );
  }

  // target: an interactive element under 44 × 44 CSS px.
  if (options.targets) {
    const controls = document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], label',
    );
    for (const control of controls) {
      if (!shown(control) || control.closest(".u-visually-hidden")) continue;
      const exempt = control.closest("[data-audit-exempt]");
      if (exempt) {
        if (!exempt.getAttribute("data-audit-exempt").trim()) {
          report(
            "target",
            exempt,
            "data-audit-exempt gives no reason: write why in the attribute",
          );
        }
        continue;
      }
      if (control.matches("label")) {
        // A label is a target of its own only when it wraps its control.
        if (!control.querySelector("input, select, textarea")) continue;
      } else if (control.closest("label")) {
        continue; // measured as its label
      }
      if (control.matches("a") && inSentence(control)) continue;
      let { left, top, right, bottom } = control.getBoundingClientRect();
      if (control.matches('input[type="checkbox"], input[type="radio"]')) {
        // A choice is tapped through its label as well.
        for (const label of control.labels) {
          const box = label.getBoundingClientRect();
          left = Math.min(left, box.left);
          top = Math.min(top, box.top);
          right = Math.max(right, box.right);
          bottom = Math.max(bottom, box.bottom);
        }
      }
      const width = right - left;
      const height = bottom - top;
      if (width < 44 - 0.01 || height < 44 - 0.01) {
        report(
          "target",
          control,
          `${px(width)} × ${px(height)}, under 44 × 44 px`,
        );
      }
    }
  }

  // inline-main-path: the primary action is a link inside a sentence.
  for (const action of document.querySelectorAll(options.mainPath)) {
    if (!shown(action)) continue;
    const link = action.closest("a") ?? action.querySelector("a");
    if (link && inSentence(link)) {
      report(
        "inline-main-path",
        action,
        `a link inside the sentence "${textOf(blockOf(link))}"`,
      );
    }
  }

  // cut: text clipped by a box, cut with an ellipsis, or past the window.
  {
    const ellipsed = new Set();
    for (const { text, element } of texts) {
      let left = 0;
      let right = viewportWidth;
      let top = -Infinity;
      let bottom = Infinity;
      let scrolled = false;
      for (
        let box = element;
        box && box !== document.body && box !== root;
        box = box.parentElement
      ) {
        const boxStyle = style(box);
        const clipsX = boxStyle.overflowX !== "visible";
        const clipsY = boxStyle.overflowY !== "visible";
        if (
          boxStyle.textOverflow === "ellipsis" &&
          clipsX &&
          box.scrollWidth > box.clientWidth + 0.5 &&
          !ellipsed.has(box)
        ) {
          ellipsed.add(box);
          report(
            "cut",
            box,
            `cut with an ellipsis: ${px(box.scrollWidth)} of text in ${px(box.clientWidth)}`,
          );
        }
        if (/auto|scroll/.test(boxStyle.overflowX)) {
          scrolled = true; // reached by scrolling the box
          break;
        }
        if (!clipsX && !clipsY) continue;
        const outer = box.getBoundingClientRect();
        const innerLeft =
          outer.left + (parseFloat(boxStyle.borderLeftWidth) || 0);
        const innerTop = outer.top + (parseFloat(boxStyle.borderTopWidth) || 0);
        if (clipsX) {
          left = Math.max(left, innerLeft);
          right = Math.min(right, innerLeft + box.clientWidth);
        }
        if (clipsY) {
          top = Math.max(top, innerTop);
          bottom = Math.min(bottom, innerTop + box.clientHeight);
        }
      }
      if (scrolled) continue;
      for (const { word, boxes } of wordsOf(text)) {
        const cut = boxes.find(
          (box) =>
            box.left < left - 0.75 ||
            box.right > right + 0.75 ||
            box.top < top - 0.75 ||
            box.bottom > bottom + 0.75,
        );
        if (!cut) continue;
        report(
          "cut",
          element,
          `"${word}" is drawn at ${px(cut.left)} to ${px(cut.right)} across, ${px(cut.top + scrollY)} to ${px(cut.bottom + scrollY)} down, but only ${px(left)} to ${px(right)} across${Number.isFinite(top) ? `, ${px(top + scrollY)} to ${px(bottom + scrollY)} down` : ""} shows`,
        );
        break; // one word per text is enough to find it
      }
    }
  }

  // small-text: rendered text under the smallest type token.
  {
    const seen = new Set();
    for (const { element } of texts) {
      if (seen.has(element)) continue;
      seen.add(element);
      const size = parseFloat(style(element).fontSize);
      if (size < options.smallestText - 0.01) {
        report(
          "small-text",
          element,
          `${px(size)}, under the smallest type token's ${px(options.smallestText)}`,
        );
      }
    }
  }

  // shift: the layout shift summed since the document started loading.
  {
    const shift = window.__hikebotShift;
    if (!shift) {
      throw new Error(
        "no layout shift was recorded: install SHIFT_OBSERVER before the page opens",
      );
    }
    if (shift.total >= options.shiftLimit) {
      const moved =
        shift.largest?.isConnected && shift.largest.nodeType === 1
          ? shift.largest
          : root;
      report(
        "shift",
        moved,
        `cumulative layout shift ${shift.total.toFixed(3)} while loading, at or over ${String(options.shiftLimit)}`,
      );
    }
  }

  // overlap: a word whose centre, hit-tested, lands on another element.
  {
    const control = (element) =>
      element.closest(
        'a[href], button, input, select, textarea, summary, [role="button"], label',
      );
    const words = [];
    for (const { text, element } of texts) {
      for (const { word, boxes } of wordsOf(text)) {
        const box = boxes[0];
        words.push({
          element,
          word,
          x: box.left + box.width / 2 + scrollX,
          y: box.top + box.height / 2 + scrollY,
        });
      }
    }
    const startX = scrollX;
    const startY = scrollY;
    const height = innerHeight;
    const pageHeight = root.scrollHeight;
    const reported = new Set();
    const step = Math.max(100, height - 60);
    for (let at = 0; at < pageHeight; at += step) {
      scrollTo(startX, at);
      for (const word of words) {
        if (word.done) continue;
        const x = word.x - scrollX;
        const y = word.y - scrollY;
        if (y < 1 || y > height - 1 || x < 0 || x >= viewportWidth) continue;
        word.done = true;
        const hit = document.elementFromPoint(x, y);
        const { element } = word;
        if (!hit || hit === element) continue;
        if (element.contains(hit) || hit.contains(element)) continue;
        const svg = hit.closest("svg");
        if (svg && svg === element.closest("svg")) continue;
        const box = hit.getBoundingClientRect();
        const drawn =
          x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
        const key = `${selectorOf(element)}|${selectorOf(hit)}`;
        if (reported.has(key)) continue;
        if (drawn) {
          reported.add(key);
          report(
            "overlap",
            element,
            `"${word.word}" lies under or over ${selectorOf(hit)} at ${px(x)}, ${px(word.y)}`,
          );
        } else if (control(element) && control(element) !== control(hit)) {
          reported.add(key);
          report(
            "overlap",
            element,
            `"${word.word}" is under the hit area of ${selectorOf(control(hit) ?? hit)} at ${px(x)}, ${px(word.y)}`,
          );
        }
      }
    }
    scrollTo(startX, startY);
  }

  return findings;
}
