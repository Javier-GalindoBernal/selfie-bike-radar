import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./theme.css";

export const metadata: Metadata = {
  title: "Selfie Bike Radar",
  description: "Tu grupo, tus rutas y tus salidas en bici. Independiente de Strava.",
  appleWebApp: { capable: true, title: "Bike Radar", statusBarStyle: "black-translucent" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#2B7A33",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
