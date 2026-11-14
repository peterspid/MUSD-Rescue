import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "@/components/providers";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Semi_Condensed({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-barlow-condensed", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jetbrains", display: "swap" });

const SITE = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "MUSD Rescue: liquidation prevention for Mezo MUSD troves", template: "%s | MUSD Rescue" },
  description: "Monitor collateral health of Mezo MUSD troves, simulate repay and add-collateral rescues against the real protocol rules, and act before liquidation risk becomes critical.",
  applicationName: "MUSD Rescue",
  keywords: ["Mezo", "MUSD", "liquidation", "trove", "Bitcoin", "DeFi", "risk"],
  openGraph: {
    type: "website",
    title: "MUSD Rescue — Know your risk. Rescue your position.",
    description: "Liquidation-prevention and collateral-health monitoring for Mezo MUSD borrowers. Live on Mezo testnet.",
    siteName: "MUSD Rescue",
  },
  twitter: { card: "summary_large_image", title: "MUSD Rescue", description: "See liquidation risk early. Understand your options. Act with confidence." },
};

export const viewport: Viewport = {
  themeColor: "#101316",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
