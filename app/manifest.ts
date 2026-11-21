import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "日序 Dayline",
    short_name: "日序 Dayline",
    description: "Derek、Suki 及 Amigo 共用的個人工作管理系統",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f6f7",
    theme_color: "#195b64",
    lang: "zh-Hant-HK",
    orientation: "any",
    categories: ["productivity", "lifestyle"],
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" }],
    share_target: {
      action: "/capture",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" }
    }
  };
}
