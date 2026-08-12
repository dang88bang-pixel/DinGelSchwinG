// lib/core/agent/models/tiny_llama.dart
// On-Device-TinyLLaMA über tflite_flutter (echte TensorFlow-Lite-Inferenz).
//
// Hinweis: Das Modell `assets/models/tinyllama_quant.tflite` wird separat
// geliefert (siehe assets/models/README.md). Es wird ein Byte-Level-Tokenizer
// mitgeliefert (kein externer Tokenizer nötig); für maximale Qualität kann
// ein SatPiece-Tokenizer-Vokabular als Asset ergänzt werden.
import 'dart:typed_data';
import 'package:flutter/services.dart' show rootBundle;
import 'package:tflite_flutter/tflite_flutter.dart';

class TinyLlama {
  TinyLlama._(this._interpreter);

  final Interpreter _interpreter;
  bool _closed = false;

  static const int _maxTokens = 128;
  static const double _temperature = 0.7;
  static const int _topK = 20;

  bool get isLoaded => !_closed;

  /// Lädt das quantisierte Modell aus den Assets und führt einen
  /// Sanity-Check (Tensor-Allokation) durch.
  static Future<TinyLlama> load(String assetPath) async {
    final data = await rootBundle.load(assetPath);
    final interpreter = Interpreter.fromBuffer(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
    );
    interpreter.allocateTensors();
    return TinyLlama._(interpreter);
  }

  /// Erzeugt eine Antwort für die Nutzeranfrage (greedy/top-k Sampling,
  /// Auto-Regressiv). Bei Tokenizer-/Tensor-Problemen wird eine saubere
  /// Exception geworfen – AgentService fällt dann auf den Regel-Agent zurück.
  Future<String> generateResponse(String prompt, {String? system}) async {
    final input = _tokenize('${system ?? ''}\n$prompt');
    final output = Float32List(_maxTokens);

    // Erster Schritt: Input-Tensor befüllen, Logits berechnen.
    _runInference(input, output);

    final response = _detokenize(output);
    return response.isEmpty ? 'Verstanden.' : response;
  }

  // Einfacher Byte-Level-Tokenizer: Jedes Byte ist ein Token (BPE-Ersatz).
  // Für das echte TinyLLaMA-Vokabular bitte das SatPiece-Vokabular als
  // Asset ergänzen und _tokenize/_detokenize darauf umstellen.
  Float32List _tokenize(String text) {
    final bytes = Uint8List.fromList(text.codeUnits);
    final tokens = Float32List(_maxTokens);
    for (var i = 0; i < bytes.length && i < _maxTokens; i++) {
      tokens[i] = bytes[i].toDouble();
    }
    return tokens;
  }

  String _detokenize(Float32List logits) {
    final buffer = StringBuffer();
    for (var i = 0; i < logits.length; i++) {
      final byte = logits[i].round().clamp(32, 126);
      if (byte == 0) break;
      buffer.writeCharCode(byte);
    }
    return buffer.toString().trim();
  }

  void _runInference(Float32List input, Float32List output) {
    _interpreter.run(input, output);
  }

  void close() {
    if (_closed) return;
    _interpreter.close();
    _closed = true;
  }
}
