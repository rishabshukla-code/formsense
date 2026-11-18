// FormSense content script. Chrome runs it inside the web page, where it can
// see the form. It answers one question for the copilot: "what's on this
// form, and which field is the user on?"
//
// Privacy: it reports labels, help text and choices, plus whether each field
// is filled in. It never reports what the user typed.

(() => {
  // The side panel may inject this file into a tab that already has it.
  if (globalThis.__formsenseLoaded) return;
  globalThis.__formsenseLoaded = true;

  const MAX_FIELDS = 40;
  const MAX_TEXT = 300;
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file", "password"]);
  let lastFocused = null;
  let nextId = 1;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const textOfIds = (ids) =>
    clean((ids || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));

  const isField = (el) => el?.matches?.("input, select, textarea") && !SKIP_TYPES.has(el.type);
  const isVisible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  // Radio buttons with the same name are one question.
  function radioGroup(el) {
    return [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
  }
  function groupBox(el) {
    return el.closest("[role=radiogroup]") || el.closest("fieldset");
  }

  function fieldId(el) {
    const target = el.type === "radio" ? radioGroup(el)[0] : el;
    if (!target.dataset.formsenseId) target.dataset.formsenseId = "f" + nextId++;
    return target.dataset.formsenseId;
  }

  function labelOf(el) {
    if (el.type === "radio") {
      const box = groupBox(el);
      if (box?.getAttribute("aria-labelledby")) return textOfIds(box.getAttribute("aria-labelledby"));
      if (box?.getAttribute("aria-label")) return clean(box.getAttribute("aria-label"));
      if (box?.matches("fieldset")) return clean(box.querySelector("legend")?.textContent);
    }
    if (el.getAttribute("aria-labelledby")) return textOfIds(el.getAttribute("aria-labelledby"));
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    if (el.labels?.length) return clean(el.labels[0].textContent);
    return clean(el.placeholder || el.title || el.name);
  }

  function helpOf(el) {
    const ids = el.getAttribute("aria-describedby") ||
      (el.type === "radio" ? groupBox(el)?.getAttribute("aria-describedby") : "");
    return ids ? textOfIds(ids) : "";
  }

  function sectionOf(el) {
    // The nearest fieldset with a legend, skipping a radio group's own box.
    let box = el.closest("fieldset");
    while (box) {
      const legend = box.querySelector(":scope > legend");
      if (legend) return clean(legend.textContent);
      box = box.parentElement?.closest("fieldset");
    }
    return "";
  }

  function choicesOf(el) {
    if (el.tagName === "SELECT") {
      return [...el.options].filter((o) => o.value !== "").map((o) => clean(o.textContent));
    }
    if (el.type === "radio") return radioGroup(el).map((r) => clean(r.labels?.[0]?.textContent || r.value));
    return undefined;
  }

  function isFilled(el) {
    if (el.type === "radio") return radioGroup(el).some((r) => r.checked);
    if (el.type === "checkbox") return el.checked;
    return el.value !== "";
  }

  function describe(el) {
    const field = {
      id: fieldId(el),
      label: labelOf(el),
      type: el.type === "radio" ? "choose one" : el.tagName === "SELECT" ? "dropdown" : el.type || el.tagName.toLowerCase(),
      section: sectionOf(el),
      required: el.required || (el.type === "radio" && radioGroup(el).some((r) => r.required)),
      filled: isFilled(el),
    };
    const help = helpOf(el);
    if (help) field.help = help;
    const choices = choicesOf(el);
    if (choices) field.choices = choices;
    return field;
  }

  function getFormContext() {
    const seen = new Set();
    const fields = [];
    let total = 0;
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!isField(el) || !isVisible(el)) continue;
      const key = el.type === "radio" ? "radio:" + el.name : el;
      if (seen.has(key)) continue;
      seen.add(key);
      total++;
      if (fields.length < MAX_FIELDS) fields.push(describe(el));
    }
    // The field the user last clicked; if we missed the click (e.g. this
    // script was added later), the field that still has the page's focus.
    const current = lastFocused && document.contains(lastFocused)
      ? lastFocused
      : isField(document.activeElement) ? document.activeElement : null;
    const focused = current ? describe(current) : null;
    return {
      page_title: clean(document.title),
      page: location.origin + location.pathname,
      focused_field: focused,
      fields,
      ...(total > fields.length ? { note: `Showing ${fields.length} of ${total} fields.` } : {}),
    };
  }

  document.addEventListener("focusin", (e) => {
    if (isField(e.target)) lastFocused = e.target;
  });

  if (globalThis.chrome?.runtime?.onMessage) {
    // Running inside the extension: answer the side panel.
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "formsense:get_form_context") sendResponse(getFormContext());
    });
  } else {
    // Development only: injected as a normal page script, answer a side panel
    // preview open in another tab of the same site.
    const channel = new BroadcastChannel("formsense-dev");
    channel.onmessage = ({ data }) => {
      if (data?.type === "formsense:get_form_context") {
        channel.postMessage({ type: "formsense:result", reqId: data.reqId, result: getFormContext() });
      }
    };
  }
})();
