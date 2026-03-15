// Web Bluetooth API type declarations for TypeScript
// The W3C spec is still evolving; this covers enough for our use case.

interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name: string | undefined;
    readonly gatt: BluetoothRemoteGATTServer | undefined;
    forget(): Promise<void>;   // Chrome 85+ — removes OS pairing
    addEventListener(type: 'gattserverdisconnected', listener: (e: Event) => void, options?: boolean | AddEventListenerOptions): void;
}

interface BluetoothRemoteGATTServer {
    readonly device: BluetoothDevice;
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
    readonly device: BluetoothDevice;
    readonly uuid: string;
    readonly isPrimary: boolean;
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly service: BluetoothRemoteGATTService;
    readonly uuid: string;
    readonly value: DataView | undefined;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(
        type: 'characteristicvaluechanged',
        listener: (e: Event) => void,
        options?: boolean | AddEventListenerOptions
    ): void;
}

interface BluetoothRequestDeviceFilter {
    services?: BluetoothServiceUUID[];
    name?: string;
    namePrefix?: string;
}

interface RequestDeviceOptions {
    filters?: BluetoothRequestDeviceFilter[];
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
}

interface Bluetooth {
    requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
    getAvailability(): Promise<boolean>;
    getDevices(): Promise<BluetoothDevice[]>;  // Chrome 85+ — lists already-paired devices
}

type BluetoothServiceUUID = number | string;
type BluetoothCharacteristicUUID = number | string;

interface Navigator {
    readonly bluetooth: Bluetooth;
}
