# FormSense (Chrome extension)

A side panel in Chrome where you talk to the voice copilot while you fill in a form. Click a field, ask "what is this asking for?", and it explains.

## Load it in Chrome (once)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension` folder.
4. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to **FormSense**.

After you change a file here, click the reload arrow on the extension's card in `chrome://extensions`, then close and reopen the side panel. Reload any form tab that was already open, too.

## Use it

1. Double-click `start-web.bat` in the project folder and wait for **Ready**.
2. Open the practice form: http://localhost:3000/practice
3. Click the **FormSense** icon in Chrome's toolbar. The side panel opens.
4. Click **Start talking**.
5. Click a field on the form and ask about it: "What is this asking for?"
6. **First time only:** Chrome can't ask for the microphone inside a side panel. Click **Set up microphone**, allow it in the tab that opens, close that tab, then press **Unmute** in the panel.

## Using it on real websites

FormSense reads the practice form out of the box. For other sites it needs your OK once:

1. Open a form on any website and ask about a field.
2. The panel shows **Allow on websites**. Click it, then click **Allow** in Chrome's prompt.
3. Ask again.

Even with permission, FormSense only reads a page when you ask a question, and the panel notes every read. To take the permission back: `chrome://extensions` → FormSense → **Details** → **Site access**.

**What it can't read yet:**

- Chrome's own pages, the Chrome Web Store, PDFs and new tabs (no extension can).
- Fields inside embedded frames (some payment boxes and embedded forms).
- Fields inside web components' shadow DOM.

**How it handles messy forms:** it uses proper labels when a site has them, and otherwise the nearby text, the placeholder or the heading above a group of options. It recognizes custom dropdowns and checkboxes by their accessibility role, lists fields from your form before others on the page, and skips site search boxes.

## How it reads the page

1. You ask about a field. The agent calls its `get_form_context` tool.
2. The tool sends a LiveKit RPC call to the side panel.
3. The side panel asks `content.js`, which runs inside the form page.
4. `content.js` replies with the page title, the field you last clicked, and each field's label, section, help text and choices.
5. The panel shows a small "Read the form" note, so you always see when the page was read.

Highlighting works the same way: the agent's `highlight_field` tool sends a field id (like `f5`) over RPC, and `content.js` scrolls to that field and outlines it in purple for 4 seconds. The panel notes "Highlighted …".

**Privacy:** `content.js` reports whether a field is filled in, never what you typed. Password and file fields are skipped.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Tells Chrome what the extension is and what it may access |
| `background.js` | Opens the side panel when you click the toolbar icon |
| `sidepanel.html`, `sidepanel.js`, `panel.css` | The voice chat panel, and the bridge that answers the agent's RPC calls |
| `content.js` | Runs inside the form page and reads its fields |
| `mic-setup.html`, `mic-setup.js` | One-time microphone permission page |
| `vendor/livekit-client.umd.js` | LiveKit's browser library, v2.22.4 from npm. Extensions can't load scripts from the internet, so it's bundled. |

## Testing without loading the extension

Run the launcher, then:

1. Open http://localhost:3000/practice in one tab and run this in its console to add the reader: ``eval(await (await fetch('/extension/content.js')).text())``
2. Open http://localhost:3000/extension/sidepanel.html in another tab. It talks to the practice tab over a `BroadcastChannel`.
