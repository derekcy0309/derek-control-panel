import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Derek Control Panel",
    short_name: "Control Panel",
    description: "私人、家庭及公司日常作業系統",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#4f46e5",
    lang: "zh-Hant-HK",
    orientation: "any",
    categories: ["productivity", "business", "lifestyle"],
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" }]
  };
}
