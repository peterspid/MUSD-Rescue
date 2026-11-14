import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "MUSD Rescue: liquidation protection for Mezo MUSD troves", template: "%s | MUSD Rescue" },
  description: "Monitor collateral health of Mezo MUSD troves, simulate repay and add-collateral rescues against the real protocol rules, and act before liquidation risk becomes critical.",
  applicationName: "MUSD Rescue",
  keywords: ["Mezo", "MUSD", "liquidation", "trove", "Bitcoin", "DeFi", "risk"],
  openGraph: {
    type: "website",
    title: "MUSD Rescue: see how far BTC can fall before liquidation",
    description: "Liquidation-prevention and collateral-health monitoring for Mezo MUSD borrowers. Live on Mezo testnet.",
    siteName: "MUSD Rescue",
  },
  twitter: { card: "summary_large_image", title: "MUSD Rescue", description: "See liquidation risk early. Understand your options. Act with confidence." },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
