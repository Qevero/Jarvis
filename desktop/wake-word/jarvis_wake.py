#!/usr/bin/env python3
"""
Jarvis desktop wake word — say "Hey Jarvis" to bring the Claude desktop app forward.

Runs entirely on your computer (openWakeWord, no cloud, no API, £0). Audio
never leaves the machine and nothing is recorded to disk.

    pip install openwakeword sounddevice numpy
    python jarvis_wake.py            # uses the "hey_jarvis" pre-trained model
    python jarvis_wake.py --model path/to/your_model.onnx

See README.md in this folder for the model licence note and auto-start setup.
"""
import argparse
import platform
import subprocess
import sys
import time

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

RATE = 16_000
CHUNK = 1_280  # 80 ms, what openWakeWord expects


def bring_claude_forward() -> None:
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.run(["open", "-a", "Claude"], check=False)
        elif system == "Windows":
            # The Claude desktop app registers the claude:// protocol.
            subprocess.run(["cmd", "/c", "start", "", "claude://"], check=False)
        else:
            subprocess.run(["xdg-open", "https://claude.ai/new"], check=False)
    except Exception as exc:  # never crash the listener
        print(f"Couldn't open Claude: {exc}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default="hey_jarvis", help="Pre-trained model name or path to a .onnx/.tflite model")
    parser.add_argument("--threshold", type=float, default=0.5, help="Detection threshold 0–1 (raise if it triggers by accident)")
    parser.add_argument("--cooldown", type=float, default=3.0, help="Seconds to ignore after a detection")
    args = parser.parse_args()

    if args.model == "hey_jarvis":
        import openwakeword
        openwakeword.utils.download_models(model_names=["hey_jarvis"])
    model = Model(wakeword_models=[args.model], inference_framework="onnx")
    print(f"Listening for “Hey Jarvis” (threshold {args.threshold}). Ctrl+C to stop.")

    last = 0.0
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=CHUNK) as stream:
        while True:
            audio, _ = stream.read(CHUNK)
            scores = model.predict(np.squeeze(audio))
            if max(scores.values()) >= args.threshold and time.time() - last > args.cooldown:
                last = time.time()
                print(time.strftime("%H:%M:%S"), "Hey Jarvis → opening Claude")
                bring_claude_forward()
                model.reset()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
