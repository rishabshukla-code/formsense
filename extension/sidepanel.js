// Voice chat in Chrome's side panel. Same flow as web/static/index.html:
// get a token from the local web server, join a LiveKit room, and the agent
// is sent into that room automatically.

const TOKEN_URL = "http://localhost:3000/api/token";
const IN_EXTENSION = Boolean(globalThis.chrome?.runtime?.id);

const { Room, RoomEvent, Track } = LivekitClient;
const $ = (id) => document.getElementById(id);
const startBtn = $("start"), muteBtn = $("mute"), endBtn = $("end");
const statusEl = $("status"), logEl = $("log");
const errEl = $("error"), errText = $("error-text"), micSetupBtn = $("mic-setup");
const bubbles = new Map();
const STATES = { listening: "Listening", thinking: "Thinking", speaking: "Speaking", initializing: "Starting up" };
let room = null;
let agentTimer = null;

function setStatus(text, cls = "") { statusEl.textContent = text; statusEl.className = "pill " + cls; }

function showError(text, { micSetup = false } = {}) {
  errText.textContent = text;
  errEl.hidden = !text;
  micSetupBtn.hidden = !micSetup;
}

function upsertBubble(id, who, text, final) {
  $("empty")?.remove();
  let el = bubbles.get(id);
  if (!el) {
    el = document.createElement("div");
    el.className = "msg " + who;
    el.innerHTML = '<span class="who"></span><span class="text"></span>';
    el.querySelector(".who").textContent = who === "you" ? "You" : "Copilot";
    logEl.appendChild(el);
    bubbles.set(id, el);
  }
  el.querySelector(".text").textContent = text;
  el.classList.toggle("partial", !final);
  logEl.scrollTop = logEl.scrollHeight;
}

function addNote(text) {
  $("empty")?.remove();
  const el = document.createElement("p");
  el.className = "note";
  el.textContent = text;
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- Reading the form on the current tab (asked for by the agent) ----

const NOT_READABLE = "FormSense can't read this page. For now it only works on the practice form at http://localhost:3000/practice.";

// Send a message to content.js in the active tab and return its reply.
async function askTabInExtension(msg) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return { error: "No browser tab is open." };
  const ask = () => chrome.tabs.sendMessage(tab.id, msg);
  try {
    return (await ask()) ?? { error: NOT_READABLE };
  } catch (first) {
    // Chrome only adds content.js to pages loaded after the extension was
    // installed or reloaded. If this tab was already open, add it now.
    console.info("content.js not in this tab yet, injecting:", first.message);
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return (await ask()) ?? { error: NOT_READABLE };
    } catch (second) {
      console.warn("Can't read this tab:", second.message);
      return { error: NOT_READABLE };
    }
  }
}

// Development only: when this panel is opened as a normal page, ask a practice
// form tab of the same site (with content.js injected) over BroadcastChannel.
function askTabInDevPreview(msg) {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel("formsense-dev");
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => { channel.close(); resolve({ error: NOT_READABLE }); }, 2000);
    channel.onmessage = ({ data }) => {
      if (data?.type !== "formsense:result" || data.reqId !== reqId) return;
      clearTimeout(timer);
      channel.close();
      resolve(data.result);
    };
    channel.postMessage({ ...msg, reqId });
  });
}

const askTab = (msg) => (IN_EXTENSION ? askTabInExtension(msg) : askTabInDevPreview(msg));

// RPC from the agent: read the form.
async function getFormContext() {
  const result = await askTab({ type: "formsense:get_form_context" });
  if (result.error) {
    addNote("Couldn't read this page");
    return JSON.stringify(result);
  }
  // LiveKit RPC replies are limited to 15 KB; drop fields from the end if needed.
  let json = JSON.stringify(result);
  while (json.length > 14000 && result.fields.length > 1) {
    result.fields.pop();
    result.note = "Some fields were left out to keep this short.";
    json = JSON.stringify(result);
  }
  const where = result.focused_field ? `, you're on "${result.focused_field.label}"` : "";
  addNote(`Read the form (${result.fields.length} fields${where})`);
  return json;
}

// RPC from the agent: point at a field.
async function highlightField(fieldId) {
  const result = await askTab({ type: "formsense:highlight_field", id: fieldId.trim() });
  if (result.ok) addNote(`Highlighted "${result.highlighted}"`);
  return JSON.stringify(result);
}

// Mic level bar: shows whether the panel is actually capturing your voice.
let meter = null;
function startMeter() {
  stopMeter();
  const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  if (!track?.mediaStreamTrack) return;
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    $("level").style.width = Math.min(100, (peak / 128) * 250) + "%";
    meter.raf = requestAnimationFrame(tick);
  };
  meter = { ctx, raf: requestAnimationFrame(tick) };
  console.info("Mic:", track.mediaStreamTrack.label, "| enabled:", track.mediaStreamTrack.enabled, "| state:", track.mediaStreamTrack.readyState);
}
function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  meter.ctx.close();
  meter = null;
  $("level").style.width = "0";
}

function updateMuteButton() {
  const on = room?.localParticipant.isMicrophoneEnabled ?? false;
  muteBtn.textContent = on ? "Mute" : "Unmute";
  muteBtn.classList.toggle("muted", !on);
  muteBtn.setAttribute("aria-pressed", String(!on));
  if (on) startMeter(); else stopMeter();
}

async function enableMic() {
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    showError("");
  } catch (err) {
    console.warn(`Microphone not available: ${err.name}: ${err.message}`);
    // Chrome can't show the permission prompt inside a side panel, so the
    // first time we send the user to a normal tab to allow the microphone.
    if (IN_EXTENSION) {
      showError("Chrome needs your OK to use the microphone. Click below, allow it, then come back and press Unmute.", { micSetup: true });
    } else {
      showError("Microphone access was blocked. Allow it in the address bar, then press Unmute.");
    }
  }
  updateMuteButton();
}

async function toggleMute() {
  if (!room) return;
  muteBtn.disabled = true;
  try {
    if (room.localParticipant.isMicrophoneEnabled) {
      await room.localParticipant.setMicrophoneEnabled(false);
      updateMuteButton();
    } else {
      await enableMic();
    }
  } finally {
    muteBtn.disabled = false;
  }
}

async function start() {
  showError("");
  startBtn.disabled = true;
  setStatus("Connecting…");
  try {
    let res;
    try {
      res = await fetch(TOKEN_URL);
    } catch {
      throw new Error("the local server isn't running. Double-click start-web.bat and try again");
    }
    if (!res.ok) throw new Error("token request failed (" + res.status + ")");
    const { url, token } = await res.json();

    room = new Room({ adaptiveStream: true, dynacast: true });
    room.localParticipant.registerRpcMethod("get_form_context", () => getFormContext());
    room.localParticipant.registerRpcMethod("highlight_field", ({ payload }) => highlightField(payload));

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      const state = changed["lk.agent.state"];
      if (participant.isAgent && state) setStatus(STATES[state] || state, state);
    });
    room.on(RoomEvent.ParticipantConnected, (p) => {
      if (!p.isAgent) return;
      clearTimeout(agentTimer);
      setStatus("Copilot joined", "listening");
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => { if (p.isAgent) setStatus("Copilot left"); });
    room.on(RoomEvent.Disconnected, () => cleanup());

    room.registerTextStreamHandler("lk.transcription", async (reader, from) => {
      const attrs = reader.info.attributes || {};
      const id = attrs["lk.segment_id"] || reader.info.id;
      const who = from.identity === room.localParticipant.identity ? "you" : "agent";
      let text = "";
      for await (const chunk of reader) {
        // User segments arrive as whole updates; agent replies stream token by token.
        text = who === "you" ? chunk : text + chunk;
        upsertBubble(id, who, text, false);
      }
      upsertBubble(id, who, text, who === "agent" || attrs["lk.transcription_final"] === "true");
    });

    await room.connect(url, token);
    await room.startAudio();
    setStatus("Waiting for copilot…");
    agentTimer = setTimeout(() => {
      if (room && ![...room.remoteParticipants.values()].some((p) => p.isAgent)) {
        setStatus("No copilot");
        showError("The copilot didn't join. Check the launcher window for errors, then press End and Start talking again.");
      }
    }, 20000);
    muteBtn.disabled = false;
    endBtn.disabled = false;
    await enableMic();
  } catch (err) {
    console.error(err);
    await room?.disconnect();
    cleanup();
    showError("Couldn't connect: " + err.message + ".");
  }
}

function cleanup() {
  clearTimeout(agentTimer);
  stopMeter();
  room = null;
  startBtn.disabled = false;
  muteBtn.disabled = true;
  endBtn.disabled = true;
  muteBtn.textContent = "Mute";
  muteBtn.classList.remove("muted");
  showError("");
  setStatus("Not connected");
}

startBtn.addEventListener("click", start);
muteBtn.addEventListener("click", toggleMute);
endBtn.addEventListener("click", () => room?.disconnect());
micSetupBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("mic-setup.html") }));
document.addEventListener("keydown", (e) => {
  if ((e.key === "m" || e.key === "M") && room && !e.repeat && e.target === document.body) toggleMute();
});
