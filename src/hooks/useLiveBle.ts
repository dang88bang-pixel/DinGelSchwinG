/**
 * useLiveBle – React-Hook für den Web-Bluetooth-Live-Zustand.
 */
import { useEffect, useState } from 'react';
import { WebBluetoothService, LiveBleDevice } from '../lib/ble/webBluetooth';

export function useLiveBle(): { device: LiveBleDevice | null; supported: boolean } {
  const [device, setDevice] = useState<LiveBleDevice | null>(WebBluetoothService.device);
  const [supported] = useState<boolean>(WebBluetoothService.isSupported());

  useEffect(() => WebBluetoothService.subscribe(() => {
    setDevice(WebBluetoothService.device);
  }), []);

  return { device, supported };
}
