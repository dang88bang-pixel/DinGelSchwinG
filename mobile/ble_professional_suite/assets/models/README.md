# On-Device-KI-Modell (TinyLLaMA, quantisiert)

Dieses Verzeichnis enthält **kein** fertiges Modell – das quantisierte
TFLite-Modell (~350 MB) ist zu groß für ein Git-Repository und wird separat
geliefert (siehe `.gitignore`).

## Modell ablegen

```bash
# 1. Modell herunterladen (TinyLLaMA 1.1B, Chat-Instructions, quantisiert)
#    z. B. über das transformers/llama.cpp-Ökosystem → TFLite exportieren
# 2. Unter folgendem Namen im Assets-Ordner ablegen:
assets/models/tinyllama_quant.tflite
```

Erwartete Datei:

| Datei | Größe (ca.) | Format |
|---|---|---|
| `tinyllama_quant.tflite` | ~350 MB | TensorFlow Lite (int8/fp16 quantisiert) |

## Fallback

Ohne Modell startet die App voll funktionsfähig mit dem **deterministischen
Regel-Agenten** (`IntentParser` + regelbasierte Antworten in
`lib/core/agent/agent_service.dart`). Der Modellstatus wird im Agent-Chat
angezeigt („TinyLLaMA aktiv“ / „Regel-Agent“).

## Tokenizer

Der Byte-Level-Tokenizer in `lib/core/agent/models/tiny_llama.dart` dient als
funktionsfähige Basis. Für maximale Qualität mit dem echten TinyLLaMA-Vokabular
das SatPiece-Vokabular als weiteres Asset ergänzen und `_tokenize`/`_detokenize`
darauf umstellen.
