// lib/core/utils/hex_converter.dart
// Konvertierung zwischen Byte-Listen und Hex/Dezimal/Binär/ASCII-Darstellung
// für den GATT-Explorer.
class HexConverter {
  const HexConverter._();

  /// Bytes → Hex-String ("4E6F72646963").
  static String toHex(List<int> bytes, {bool withPrefix = false}) {
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0').toUpperCase()).join();
    return withPrefix ? '0x$hex' : hex;
  }

  /// Hex-String ("BEEF" oder "0xBEEF") → Bytes.
  static List<int> fromHex(String hex) {
    final clean = hex.replaceAll(RegExp(r'0x|[\s:-]'), '');
    if (clean.isEmpty) return const [];
    if (clean.length.isOdd) {
      throw FormatException('Ungerade Hex-Länge: $hex');
    }
    return [
      for (var i = 0; i < clean.length; i += 2)
        int.parse(clean.substring(i, i + 2), radix: 16),
    ];
  }

  /// Bytes → Dezimal-Liste ("78 111 114").
  static String toDecimal(List<int> bytes) => bytes.join(' ');

  /// Bytes → Binär-String ("01001110 01101111 …").
  static String toBinary(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(2).padLeft(8, '0')).join(' ');

  /// Bytes → ASCII (nicht druckbare Zeichen werden als "." dargestellt).
  static String toAscii(List<int> bytes) => bytes
      .map((b) => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.')
      .join();

  /// Bytes → UUID-Stil ("0000180a-0000-1000-8000-00805f9b34fb").
  static String toUuid(List<int> bytes) {
    if (bytes.length != 16) return toHex(bytes);
    final h = toHex(bytes);
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
        '${h.substring(16, 20)}-${h.substring(20)}';
  }
}
