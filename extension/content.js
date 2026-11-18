// FormSense content script. Chrome runs it inside the web page, where it can
// see the form. It answers two requests from the side panel: "what's on this
// form, and which field is the user on?" and "highlight this field".
//
// Privacy: it reports labels, help text, choices and hints, plus whether each
// field is filled in. It never reports what the user typed.

(() => {
  // The side panel may inject this file into a tab that already has it.
  if (globalThis.__formsenseLoaded) return;
  globalThis.__formsenseLoaded = true;

  const MAX_FIELDS = 40;
  const MAX_TEXT = 300;
  const NATIVE = "input, select, textarea";
  // Custom controls that sites build out of divs, recognized by their role.
  const CUSTOM = '[role=textbox], [role=combobox], [role=listbox], [role=checkbox], [role=radio], [role=switch], [contenteditable=""], [contenteditable=true]';
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "file", "password"]);
  // Text inside these never counts as a label (it could be what the user typed).
  const NOT_LABEL_TEXT = "select, option, textarea, input, script, style, noscript, button, [contenteditable], [aria-hidden=true]";

  let lastFocused = null;
  let nextId = 1;

  const clean = (s, max = MAX_TEXT) => (s || "").replace(/\s+/g, " ").trim().slice(0, max);
  const textOfIds = (ids) =>
    clean((ids || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" "));

  function isField(el) {
    if (!(el instanceof Element)) return false;
    if (el.matches(NATIVE)) return !SKIP_TYPES.has(el.type) && !el.disabled;
    // A custom control that wraps a native field is described by that field.
    return el.matches(CUSTOM) && !el.querySelector(NATIVE) && el.getAttribute("aria-disabled") !== "true";
  }
  const isVisible = (el) => Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const isRadio = (el) => el.type === "radio" || el.getAttribute("role") === "radio";
  const isSearch = (el) => el.type === "search" || Boolean(el.closest("[role=search]"));

  // Radio buttons with the same name are one question.
  function radioGroup(el) {
    if (el.type === "radio") {
      return [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
    }
    const box = el.closest("[role=radiogroup]");
    return box ? [...box.querySelectorAll("[role=radio]")] : [el];
  }
  const groupBox = (el) => el.closest("[role=radiogroup]") || el.closest("fieldset");

  function fieldId(el) {
    const target = isRadio(el) ? radioGroup(el)[0] : el;
    if (!target.dataset.formsenseId) target.dataset.formsenseId = "f" + nextId++;
    return target.dataset.formsenseId;
  }

  // Visible text near a field, for sites that don't use proper <label>s.
  // Walks up a few levels, stopping before a container that holds other fields.
  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node.parentElement; depth++) {
      node = node.parentElement;
      if (node.matches("form, body, main")) break;
      const fieldsInside = [...node.querySelectorAll(`${NATIVE}, ${CUSTOM}`)].filter(isField);
      if (fieldsInside.length > 1 && !(isRadio(el) && fieldsInside.every(isRadio))) break;
      const text = visibleText(node);
      if (text) return text;
    }
    return "";
  }

  function visibleText(root) {
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(NOT_LABEL_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    while (walker.nextNode() && parts.join(" ").length < 200) parts.push(walker.currentNode.textContent);
    return clean(parts.join(" "), 200);
  }

  // The question for a radio group with no proper group label: the nearest
  // text just before the smallest box that holds all of its options.
  function groupQuestion(el) {
    const radios = radioGroup(el);
    let box = radios[0].parentElement;
    while (box && !radios.every((r) => box.contains(r))) box = box.parentElement;
    for (let node = box, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      let prev = node.previousElementSibling;
      while (prev && !visibleText(prev)) prev = prev.previousElementSibling;
      if (!prev) continue;
      const hasFields = [...prev.querySelectorAll(`${NATIVE}, ${CUSTOM}`)].some(isField);
      return hasFields ? "" : visibleText(prev);
    }
    return "";
  }

  // Some sites point <label for> at the question's wrapper box instead of the
  // field, so the browser never links them. Follow it from the field upward.
  function containerLabel(el) {
    for (let node = el.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
      if (node.matches("form, body")) break;
      if (!node.id) continue;
      const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      const text = label ? visibleText(label) : "";
      if (text) return text;
    }
    return "";
  }

  // The text of one option (radio or checkbox), even when its label isn't linked.
  function optionText(el) {
    const own = el.labels?.length ? visibleText(el.labels[0]) : "";
    if (own) return own;
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const box = el.parentElement;
    const alone = box && [...box.querySelectorAll(`${NATIVE}, ${CUSTOM}`)].filter(isField).length === 1;
    return (alone && visibleText(box)) || clean(el.textContent, 80) || clean(el.value, 80);
  }

  function labelOf(el) {
    if (isRadio(el)) {
      const box = groupBox(el);
      if (box?.getAttribute("aria-labelledby")) return textOfIds(box.getAttribute("aria-labelledby"));
      if (box?.getAttribute("aria-label")) return clean(box.getAttribute("aria-label"));
      if (box?.matches("fieldset")) {
        const legend = clean(box.querySelector("legend")?.textContent);
        if (legend) return legend;
      }
      // An option's own label isn't the question; look for the question's label
      // or a heading above the group.
      return containerLabel(el) || groupQuestion(el) || "Choose one";
    }
    if (el.getAttribute("aria-labelledby")) return textOfIds(el.getAttribute("aria-labelledby"));
    if (el.type === "checkbox" || el.getAttribute("role") === "checkbox") {
      // One box in a list ("Do you get any of these?"): give the question and the option.
      const option = el.getAttribute("aria-label") ? clean(el.getAttribute("aria-label")) : optionText(el);
      const question = containerLabel(el);
      if (question && option && question !== option) return `${question}: ${option}`;
      if (option) return option;
    }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    if (el.labels?.length) {
      const text = clean([...el.labels].map((l) => visibleText(l)).join(" "));
      if (text) return text;
    }
    return clean(el.title) || containerLabel(el) || nearbyText(el) || clean(el.placeholder) || clean(el.name) || "(no label)";
  }

  function helpOf(el) {
    const ids = el.getAttribute("aria-describedby") ||
      (isRadio(el) ? groupBox(el)?.getAttribute("aria-describedby") : "");
    return ids ? textOfIds(ids) : "";
  }

  function sectionOf(el) {
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
      return [...el.options]
        .filter((o, i) => o.value !== "" && !o.disabled &&
          // A first option like "Please select" is a placeholder, not a choice.
          !(i === 0 && /^[-\s]*(please\s+)?(select|choose)\b/i.test(o.textContent.trim())))
        .slice(0, 30)
        .map((o) => clean(o.textContent, 80));
    }
    if (isRadio(el)) return radioGroup(el).map(optionText);
    return undefined;
  }

  function isFilled(el) {
    if (isRadio(el)) return radioGroup(el).some((r) => r.checked || r.getAttribute("aria-checked") === "true");
    if (el.type === "checkbox") return el.checked;
    const role = el.getAttribute("role");
    if (role === "checkbox" || role === "switch") return el.getAttribute("aria-checked") === "true";
    if (el.matches(NATIVE)) return el.value !== "";
    return clean(el.textContent) !== "";
  }

  function typeOf(el) {
    if (isRadio(el)) return "choose one";
    if (el.tagName === "SELECT") return "dropdown";
    const role = el.getAttribute("role");
    if (role === "combobox" || role === "listbox") return "dropdown";
    if (role) return role;
    if (el.isContentEditable) return "text";
    return el.type || el.tagName.toLowerCase();
  }

  function describe(el) {
    const label = labelOf(el);
    const field = {
      id: fieldId(el),
      label,
      type: typeOf(el),
      section: sectionOf(el),
      required: el.required || el.getAttribute("aria-required") === "true" ||
        (el.type === "radio" && radioGroup(el).some((r) => r.required)),
      filled: isFilled(el),
    };
    const help = helpOf(el);
    if (help) field.help = help;
    const hint = clean(el.placeholder, 120);
    if (hint && hint !== label) field.hint = hint;
    const choices = choicesOf(el);
    if (choices) field.choices = choices;
    // Only a yes/no flag; the browser's own error text can quote the typed value.
    if (el.getAttribute("aria-invalid") === "true" || (field.filled && el.validity && !el.validity.valid)) {
      field.looks_invalid = true;
    }
    return field;
  }

  function currentField() {
    if (lastFocused && document.contains(lastFocused)) return lastFocused;
    const active = document.activeElement;
    if (isField(active)) return active;
    const custom = active?.closest?.(CUSTOM);
    return isField(custom) ? custom : null;
  }

  // A frame big enough to hold a form (not a hidden tracking or chat frame).
  const hasVisibleFrame = () =>
    [...document.querySelectorAll("iframe")].some((f) => f.offsetWidth > 150 && f.offsetHeight > 80);

  function getFormContext() {
    const current = currentField();
    const currentForm = current?.closest("form");
    const seen = new Set();
    const all = [];
    for (const el of document.querySelectorAll(`${NATIVE}, ${CUSTOM}`)) {
      if (!isField(el) || !isVisible(el)) continue;
      if (isSearch(el) && el !== current) continue; // site search boxes aren't the form
      const key = isRadio(el) ? radioGroup(el)[0] : el;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(el);
    }
    // Fields from the same form as the user's field come first.
    if (currentForm) all.sort((a, b) => (b.closest("form") === currentForm) - (a.closest("form") === currentForm));
    const fields = all.slice(0, MAX_FIELDS).map(describe);
    return {
      page_title: clean(document.title),
      page: location.origin + location.pathname,
      focused_field: current ? describe(current) : null,
      fields,
      ...(all.length > fields.length ? { note: `Showing ${fields.length} of ${all.length} fields.` } : {}),
      ...(hasVisibleFrame() ? { frames_note: "This page has embedded frames; fields inside them can't be read yet." } : {}),
    };
  }

  // Scroll to a field and outline it for a few seconds, without moving focus.
  function highlightField(id) {
    const el = document.querySelector(`[data-formsense-id="${CSS.escape(id || "")}"]`);
    if (!el) return { error: `No field with id "${id}". Call get_form_context for current ids.` };
    const target = (isRadio(el) && groupBox(el)) || el;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const saved = { outline: target.style.outline, outlineOffset: target.style.outlineOffset, borderRadius: target.style.borderRadius };
    Object.assign(target.style, { outline: "3px solid #7f77dd", outlineOffset: "4px", borderRadius: target.style.borderRadius || "6px" });
    clearTimeout(target.__formsenseTimer);
    target.__formsenseTimer = setTimeout(() => Object.assign(target.style, saved), 4000);
    return { ok: true, highlighted: labelOf(el) };
  }

  function handle(msg) {
    if (msg?.type === "formsense:get_form_context") return getFormContext();
    if (msg?.type === "formsense:highlight_field") return highlightField(msg.id);
    return undefined;
  }

  // The field a click was about: the field itself, its linked label, or the
  // only field in the question box around the click (e.g. clicking the
  // question text, or a "Yes" label that isn't linked to its button).
  function fieldNear(target) {
    if (!(target instanceof Element)) return null;
    if (isField(target)) return target;
    const custom = target.closest(CUSTOM);
    if (isField(custom)) return custom;
    const control = target.closest("label")?.control;
    if (isField(control)) return control;
    for (let node = target, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      if (node.matches("form, body, main")) break;
      const inside = [...node.querySelectorAll(`${NATIVE}, ${CUSTOM}`)].filter((f) => isField(f) && isVisible(f));
      if (inside.length === 1) return inside[0];
      if (inside.length > 1) {
        const oneGroup = inside.every(isRadio) && new Set(inside.map((f) => radioGroup(f)[0])).size === 1;
        return oneGroup ? inside[0] : null;
      }
    }
    return null;
  }

  document.addEventListener("focusin", (e) => {
    const el = isField(e.target) ? e.target : e.target?.closest?.(CUSTOM);
    if (isField(el)) lastFocused = el;
  }, true);
  document.addEventListener("pointerdown", (e) => {
    const el = fieldNear(e.target);
    if (el) lastFocused = el;
  }, true);

  if (globalThis.chrome?.runtime?.onMessage) {
    // Running inside the extension: answer the side panel.
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const result = handle(msg);
      if (result !== undefined) sendResponse(result);
    });
  } else {
    // Development only: injected as a normal page script, answer a side panel
    // preview open in another tab of the same site.
    const channel = new BroadcastChannel("formsense-dev");
    channel.onmessage = ({ data }) => {
      const result = handle(data);
      if (result !== undefined) channel.postMessage({ type: "formsense:result", reqId: data.reqId, result });
    };
  }

  // For testing in a page console: __formsenseRead()
  globalThis.__formsenseRead = getFormContext;
})();
