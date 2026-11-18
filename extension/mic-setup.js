// One-time page: asks for microphone access in a normal tab, because Chrome
// can't show that prompt inside the side panel. The permission then applies to
// the whole extension, including the side panel.

const msg = document.getElementById("msg");
const ask = document.getElementById("ask");

async function requestMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = "Done. Close this tab, go back to the side panel and press Unmute.";
    msg.className = "ok";
    ask.hidden = true;
  } catch (err) {
    console.error(err);
    msg.textContent = "The microphone is still blocked. Click the icon at the left of the address bar, set Microphone to Allow, then press the button again.";
  }
}

ask.addEventListener("click", requestMic);
requestMic();
