# Desktop wake word (optional)

Say **"Hey Jarvis"** and the Claude desktop app comes to the front, ready for you to start voice mode with the Jarvis connector. It runs locally with [openWakeWord](https://github.com/dscripka/openWakeWord). There's no cloud and no cost, and audio never leaves your computer.

## ⚠️ Model licence: read this first

openWakeWord's code is Apache 2.0, but its **pre-trained models (including `hey_jarvis`) are licensed CC BY-NC-SA 4.0, which means non-commercial use only**. Qevero is a business, so to be safe, use one of these:

- **Train your own "Hey Jarvis" model** with openWakeWord's free training notebook (synthetic speech, about an hour on Google Colab's free tier). Your own model is yours to use commercially. Then run `python jarvis_wake.py --model hey_jarvis_qevero.onnx`.
- Or use the pre-trained model only if you're satisfied your use is personal/non-commercial.

## Set up (Mac)

```bash
cd desktop/wake-word
```

```bash
python3 -m venv .venv && source .venv/bin/activate
```

```bash
pip install openwakeword sounddevice numpy
```

```bash
python jarvis_wake.py
```

macOS will ask for **microphone access** for Terminal (or Python) the first time; allow it in System Settings → Privacy & Security → Microphone.

**Start at login:** create `~/Library/LaunchAgents/com.qevero.jarvis-wake.plist` pointing at `.venv/bin/python` and `jarvis_wake.py` with `RunAtLoad` set to true, then run `launchctl load` on it.

## Set up (Windows)

Same `pip install`, then run `python jarvis_wake.py`. To start it at login, put a shortcut to `pythonw.exe jarvis_wake.py` in `shell:startup`.

## Tuning

- `--threshold 0.6` if it triggers on TV or meetings; `0.4` if it misses you.
- `--cooldown 5` to ignore repeats.
- It only brings Claude forward. Starting voice mode is one click or shortcut inside the app.
