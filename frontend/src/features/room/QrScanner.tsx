"use client";

import { Scanner } from "@yudiel/react-qr-scanner";

/** Camera QR scanner; mounted only while the scan tab is open. */
export default function QrScanner({
  onCode,
  onError,
}: {
  onCode: (raw: string) => void;
  onError: (msg: string) => void;
}) {
  return (
    <Scanner
      onScan={(codes) => codes[0] && onCode(codes[0].rawValue)}
      onError={(e) => onError(e.message || "Kamera tidak bisa dibuka.")}
      constraints={{ facingMode: "environment" }}
      sound={false}
      styles={{ container: { borderRadius: 10, overflow: "hidden" } }}
    />
  );
}
