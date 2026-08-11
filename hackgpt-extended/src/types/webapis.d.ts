// Minimale Typdeklarationen für Web-Serial/Web-USB/Web-Bluetooth (lokale Definitionen,
// damit keine externen @types-Pakete nötig sind).
interface Navigator {
  serial?: {
    requestPort(opts?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }): Promise<any>;
    getPorts(): Promise<Array<{ getInfo(): Promise<any> }>>;
  };
  usb?: {
    getDevices(): Promise<Array<{ vendorId: number; productId: number; productName?: string; serialNumber?: string }>>;
  };
  bluetooth?: { getDevices?(): Promise<Array<{ id: string; name?: string }>> };
}

interface SerialPort {
  open(opts: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
