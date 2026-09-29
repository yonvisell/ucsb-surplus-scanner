export const CATEGORIES = [
  "Desktop",
  "Laptop",
  "Monitor",
  "Server",
  "Network equipment",
  "Printer",
  "Storage media",
  "Phone / tablet",
  "Peripheral / cable",
  "Other",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const MAKES = [
  "Apple",
  "Dell",
  "HP",
  "Lenovo",
  "Cisco",
  "Epson",
  "LG",
  "Samsung",
  "Microsoft",
  "Other",
];
export type StorageStatus =
  | "unknown"
  | "none"
  | "needs-sanitization"
  | "wiped-verified"
  | "removed";
export type AssetState = "unknown" | "present" | "not-found";
export type CaptureSource =
  | "manual"
  | "keyboard"
  | "barcode"
  | "photo-barcode"
  | "ocr";
export interface Capture {
  value: string;
  source: CaptureSource;
  format: string;
  capturedAt: string;
}
export interface Batch {
  id: string;
  name: string;
  department: string;
  location: string;
  scannedBy: string;
  defaultCategory: Category;
  defaultManufacturer: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface Asset {
  id: string;
  batchId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  category: Category;
  manufacturer: string;
  model: string;
  serial: string;
  assetTag: string;
  assetState: AssetState;
  quantity: number;
  storageStatus: StorageStatus;
  mediaSerial: string;
  wipeReference: string;
  verifiedBy: string;
  verifiedAt: string;
  location: string;
  scannedBy: string;
  notes: string;
  handlingFlag: boolean;
  captures: Capture[];
}
export type AssetInput = Omit<
  Asset,
  "id" | "createdAt" | "updatedAt" | "revision"
>;
export interface Backup {
  schema: "ucsb-surplus-scanner";
  version: 1;
  exportedAt: string;
  batches: Batch[];
  assets: Asset[];
}
