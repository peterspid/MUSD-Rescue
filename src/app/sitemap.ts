import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://musd-rescue.vercel.app";
  return ["", "/dashboard", "/radar", "/demo", "/alerts", "/activity", "/settings", "/methodology", "/legal"].map((p) => ({ url: `${base}${p}`, changeFrequency: "daily", priority: p === "" ? 1 : 0.6 }));
}
