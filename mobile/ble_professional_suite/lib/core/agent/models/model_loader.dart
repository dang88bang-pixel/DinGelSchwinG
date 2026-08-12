// lib/core/agent/models/model_loader.dart
// Modell-Download-/Verfügbarkeitscheck für das On-Device-TinyLLaMA.
//
// Das quantisierte Modell (~350 MB) wird nicht im Repo gecheckt
// (siehe .gitignore + assets/models/README.md). Dieser Loader prüft,
// ob das Asset existiert, und gibt eine klare Fehlermeldung, damit der
// Regel-Agent aktiviert werden kann.
import 'package:flutter/services.dart' show AssetBundle, rootBundle;

class ModelLoader {
  const ModelLoader._();

  static const String modelAsset = 'assets/models/tinyllama_quant.tflite';

  /// Prüft, ob das Modell-Asset vorhanden ist (lädt nur die Metadaten).
  static Future<bool> isModelAvailable({AssetBundle? bundle}) async {
    try {
      final data = await (bundle ?? rootBundle).load(modelAsset);
      return data.lengthInBytes > 1024 * 1024; // > 1 MB → plausibel geladen
    } catch (_) {
      return false;
    }
  }

  static String describe() => 'Modell-Asset: $modelAsset (Download siehe '
      'assets/models/README.md)';
}
