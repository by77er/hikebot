/**
 * Cairn's press and busy states ("States" in docs/design-system.md), loaded
 * by every page (`Layout` in src/web/layout.tsx) as a module from the
 * Worker's own origin.
 *
 * Pressed: browsers apply `:active` to a finger only when it lifts, so this
 * sets `data-pressed` on the control under the pointer from `pointerdown`,
 * for a finger as for a mouse, and clears it on `pointerup`,
 * `pointercancel` (the browser took the gesture as a scroll), when the
 * pointer leaves the control, and when the window loses focus. Every
 * `:active` rule in Cairn has a `[data-pressed]` twin.
 *
 * Busy: from a form's submit until the next page loads, the button that
 * submitted it carries `aria-busy="true"` (drawn with the pressed fill),
 * and a second submit of the same form is ignored, so a vote is not sent
 * twice. A page brought back from the back-forward cache is no longer busy.
 *
 * It changes no layout and starts no work; without it, `:active` and the
 * browser's own loading indicator are the press and the busy state.
 */

const PRESSABLE =
  'a[href], button, summary, label, [role="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';

/** The controls pressed now. */
let held = [];

function release() {
  for (const element of held) element.removeAttribute("data-pressed");
  held = [];
}

addEventListener(
  "pointerdown",
  (event) => {
    if (!event.isPrimary || event.button > 0) return;
    release();
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest(PRESSABLE);
    if (
      !control ||
      control.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
    ) {
      return;
    }
    control.setAttribute("data-pressed", "");
    held.push(control);
  },
  { capture: true, passive: true },
);

for (const type of ["pointerup", "pointercancel", "dragstart", "blur"]) {
  addEventListener(type, release, { capture: true, passive: true });
}

/**
 * Lets the press go once the pointer is off the control it pressed: on
 * `pointerleave`, and on a move off it (a browser that keeps sending a held
 * mouse's events to the pressed control sends no `pointerleave`).
 */
function leave(event) {
  if (held.length === 0) return;
  if (event.type === "pointerleave") {
    if (held.includes(event.target)) release();
    return;
  }
  const under = document.elementFromPoint(event.clientX, event.clientY);
  if (!held.some((control) => control.contains(under))) release();
}

addEventListener("pointerleave", leave, { capture: true, passive: true });
addEventListener("pointermove", leave, { capture: true, passive: true });

/** Forms submitted on this page, until the next one loads. */
let sent = new WeakSet();

addEventListener("submit", (event) => {
  if (event.defaultPrevented) return;
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (sent.has(form)) {
    event.preventDefault();
    return;
  }
  sent.add(form);
  const button =
    event.submitter ??
    form.querySelector('button:not([type]), [type="submit"]');
  button?.setAttribute("aria-busy", "true");
});

addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  release();
  for (const button of document.querySelectorAll('[aria-busy="true"]')) {
    button.removeAttribute("aria-busy");
  }
  sent = new WeakSet();
});
