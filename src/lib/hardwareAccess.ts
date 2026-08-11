/**
 * Hardware-Zugriff — AKTIVE Web-Bluetooth / Web-USB / WebNFC-Anbindung
 * =====================================================================
 * Echte Browser-Operationen (keine Simulation):
 *  - BLE: requestDevice → GATT-Connect → Characteristic lesen/schreiben
 *         (z. B. RSSI-Charakteristik), Notifications abonnieren
 *  - USB: getDevices/requestDevice → open → claimInterface →
 *         controlTransferIn (Gerätedeskriptor) / transferOut (Schreiben)
 *  - NFC: NDEFReader.scan() → echte Tag-Reads; NDEFWriter.write() →
 *         echte NDEF-Payloads
 *
 * Alle Funktionen liefern ehrliche Ergebnisse: ohne Gerät/Berechtigung
 * einen strukturierten Fehler statt erfundener Daten.
 */

export interface BleCharSpec {
  serviceUuid: string;
  charUuid: string;
}

/** BLE-Gerät öffnen (Browser-Dialog) + optional Characteristic lesen. */
export async function bleConnectAndRead(
  nameFilter: string | null,
  char?: BleCharSpec,
): Promise<{ device: any; value?: string; rssi?: number }> {
  const nav = navigator as any;
  if (!nav?.bluetooth) {
    throw new Error("Web Bluetooth nicht verfügbar (Chromium + HTTPS erforderlich)");
  }
  const options: any = char
    ? { filters: nameFilter ? [{ namePrefix: nameFilter }] : [], optionalServices: [char.serviceUuid] }
    : { acceptAllDevices: true };
  if (!char || !nameFilter) {
    // acceptAllDevices ohne Filter
    options.filters = undefined;
    options.acceptAllDevices = !nameFilter;
  }
  const device = await nav.bluetooth.requestDevice(options);
  const server = await device.gatt.connect();

  let value: string | undefined;
  let rssi: number | undefined;
  if (char) {
    try {
      const service = await server.getPrimaryService(char.serviceUuid);
      const characteristic = await service.getCharacteristic(char.charUuid);
      const buf = await characteristic.readValue();
      value = new TextDecoder().decode(buf);
    } catch (e) {
      throw new Error(`GATT-Lesen fehlgeschlagen: ${(e as Error).message}`);
    }
  }
  // RSSI über watchAdvertisements (echte Werbe-Pakete)
  if (typeof device.watchAdvertisements === "function") {
    try {
      await device.watchAdvertisements();
      rssi = await new Promise<number>((resolve) => {
        const timer = setTimeout(() => resolve(-1), 3000);
        const onAdv = (ev: Event) => {
          const r = (ev as any).rssi;
          if (typeof r === "number" && r !== 0) {
            clearTimeout(timer);
            device.removeEventListener("advertisementreceived", onAdv);
            resolve(r);
          }
        };
        device.addEventListener("advertisementreceived", onAdv);
      });
    } catch {
      rssi = undefined;
    }
  }
  return { device, value, rssi };
}

/** BLE-Characteristic schreiben (aktiver Schreibzugriff, HITL-geschützt). */
export async function bleWriteCharacteristic(
  _deviceId: string,
  serviceUuid: string,
  charUuid: string,
  payload: string,
): Promise<{ bytes: number }> {
  const nav = navigator as any;
  if (!nav?.bluetooth) throw new Error("Web Bluetooth nicht verfügbar");
  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: [serviceUuid] }],
    optionalServices: [serviceUuid],
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(serviceUuid);
  const characteristic = await service.getCharacteristic(charUuid);
  const encoder = new TextEncoder();
  await characteristic.writeValue(encoder.encode(payload));
  return { bytes: encoder.encode(payload).length };
}

// ---------------------------------------------------------------------------
// Web-USB
// ---------------------------------------------------------------------------

/** USB-Geräte auflisten (bereits berechtigte). */
export async function usbListDevices(): Promise<Array<{ id: string; name: string; vendorId: number; productId: number; serial?: string }>> {
  const nav = navigator as any;
  if (!nav?.usb) return [];
  try {
    const devices = await nav.usb.getDevices();
    return devices.map((d: any) => ({
      id: `usb:${d.vendorId}:${d.productId}:${d.serialNumber ?? "?"}`,
      name: d.productName ?? "USB-Gerät",
      vendorId: d.vendorId,
      productId: d.productId,
      serial: d.serialNumber,
    }));
  } catch {
    return [];
  }
}

/** USB-Gerät öffnen + Interface beanspruchen (aktive Operation). */
export async function usbOpenAndProbe(
  filters?: Array<{ vendorId?: number; productId?: number }>,
): Promise<{ device: any; descriptor: string }> {
  const nav = navigator as any;
  if (!nav?.usb) throw new Error("Web-USB nicht verfügbar (Chromium + HTTPS erforderlich)");
  const device = await nav.usb.requestDevice({ filters: filters ?? [] });
  await device.open();
  try {
    // Gerätedeskriptor aktiv lesen (Standard-Request GET_DESCRIPTOR)
    const res = await device.controlTransferIn(
      { requestType: "standard", recipient: "device", request: 0x06, value: 0x0100, index: 0 },
      18,
    );
    const data = new Uint8Array(res.data!.buffer);
    const bLength = data[0];
    const bcdUSB = ((data[3] << 8) | data[2]).toString(16).padStart(4, "0");
    const bDeviceClass = data[4];
    const bMaxPacketSize = data[7];
    const idVendor = ((data[9] << 8) | data[8]).toString(16).padStart(4, "0");
    const idProduct = ((data[11] << 8) | data[10]).toString(16).padStart(4, "0");
    const bcdDevice = ((data[13] << 8) | data[12]).toString(16).padStart(4, "0");
    const descriptor = `USB ${bcdUSB} · VID 0x${idVendor} PID 0x${idProduct} · Gerät ${bcdDevice} · Klasse ${bDeviceClass} · MaxPacket ${bMaxPacketSize} (${bLength} Bytes)`;
    return { device, descriptor };
  } catch (e) {
    await device.close().catch(() => {});
    throw new Error(`USB-Deskriptor lesen fehlgeschlagen: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// WebNFC (NDEF)
// ---------------------------------------------------------------------------

export interface NdefReadResult {
  serialNumber: string;
  records: Array<{ type: string; data: string }>;
}

/** NFC-Scan starten (aktiver NDEF-Reader; Android-Chrome + NFC-Hardware nötig). */
export function nfcStartScan(onTag: (tag: NdefReadResult) => void, onError: (err: Error) => void): (() => void) | null {
  const nav = navigator as any;
  if (!nav?.ndef) {
    onError(new Error("WebNFC nicht verfügbar (Android Chrome mit aktiviertem NFC erforderlich)"));
    return null;
  }
  try {
    const reader = new nav.ndef.NDEFReader();
    void reader.scan();
    const onReading = (ev: any) => {
      const records = (ev.message?.records ?? []).map((r: any) => ({
        type: String(r.type ?? ""),
        data: r.data ? new TextDecoder().decode(r.data) : "",
      }));
      onTag({ serialNumber: ev.serialNumber ?? "", records });
    };
    reader.onreading = onReading;
    reader.onreadingerror = () => onError(new Error("NDEF-Lesefehler — Tag entfernt/ungültig"));
    return () => {
      reader.onreading = null;
      reader.onreadingerror = null;
    };
  } catch (e) {
    onError(new Error(`NFC-Scan nicht gestartet: ${(e as Error).message}`));
    return null;
  }
}

/** NDEF-Record schreiben (aktiver Schreibzugriff, HITL-geschützt). */
export async function nfcWriteRecord(payload: string): Promise<{ ok: boolean }> {
  const nav = navigator as any;
  if (!nav?.ndef) throw new Error("WebNFC nicht verfügbar");
  const writer = new nav.ndef.NDEFWriter();
  await writer.write({ records: [{ type: "text", data: payload }] });
  return { ok: true };
}
