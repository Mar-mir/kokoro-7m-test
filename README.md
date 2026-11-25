---
title: Kokoro 7M WebGPU
emoji: 🗣️
colorFrom: red
colorTo: yellow
sdk: static
app_file: index.html
pinned: false
license: apache-2.0
short_description: 7.5M-param Kokoro TTS running in-browser on WebGPU
models:
  - oddadmix/Kokoro-7M-Distill
  - mrfakename/Kokoro-7M-Distill-ONNX
  - onnx-community/Kokoro-82M-v1.0-ONNX
  - hexgrad/Kokoro-82M
---

Client-side text-to-speech with [oddadmix/Kokoro-7M-Distill](https://huggingface.co/oddadmix/Kokoro-7M-Distill), exported to ONNX at [mrfakename/Kokoro-7M-Distill-ONNX](https://huggingface.co/mrfakename/Kokoro-7M-Distill-ONNX) and run with onnxruntime-web on WebGPU (WASM fallback) in a Web Worker.

- Phonemes come from `misaki.js`, a JavaScript port of the [misaki](https://github.com/hexgrad/misaki) US-English G2P the model was trained on (gold/silver lexicons plus espeak-ng via phonemizer.js for unknown words).
- Optional side-by-side with Kokoro-82M ([onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)) on the same phonemes.
