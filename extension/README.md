# Form Copilot (Chrome extension)

A side panel in Chrome where you talk to the voice agent while you fill in a form.

## Load it in Chrome (once)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `extension` folder.
4. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to **Form Copilot**.

After you change a file here, click the reload arrow on the extension's card in `chrome://extensions`, then close and reopen the side panel.

## Use it

1. Double-click `start-web.bat` in the project folder and wait for **Ready**.
2. Click the **Form Copilot** icon in Chrome's toolbar. The side panel opens.
3. Click **Start talking**.
4. **First time only:** Chrome can't ask for the microphone inside a side panel. Click **Set up microphone**, allow it in the tab that opens, close that tab, then press **Unmute** in the panel.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Tells Chrome what the extension is and what it may access |
| `background.js` | Opens the side panel when you click the toolbar icon |
| `sidepanel.html`, `sidepanel.js`, `panel.css` | The voice chat panel |
| `mic-setup.html`, `mic-setup.js` | One-time microphone permission page |
| `vendor/livekit-client.umd.js` | LiveKit's browser library, v2.22.4 from npm. Extensions can't load scripts from the internet, so it's bundled. |

To preview the panel without loading the extension, run the launcher and open http://localhost:3000/extension/sidepanel.html
