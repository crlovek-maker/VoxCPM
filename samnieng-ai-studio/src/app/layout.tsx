import type { Metadata, Viewport } from "next";
import "@fontsource-variable/noto-sans-khmer";
import "./globals.css";

export const metadata: Metadata = {
  title: "សំនៀង AI Studio",
  description: "Khmer-first lyrics-to-song studio · បំប្លែងអត្ថបទចម្រៀងទៅជាបទចម្រៀង",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#17110f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="km">
      <body>{children}</body>
    </html>
  );
}
