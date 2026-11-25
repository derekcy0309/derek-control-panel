import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";
import "./dayline.css";
import "./dayline-dark-contrast.css";

export const metadata: Metadata = {
  title: { default: "日序 Dayline", template: "%s · 日序 Dayline" },
  description: "Derek、Suki 及 Amigo 共用的個人工作管理系統",
  applicationName: "日序 Dayline",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "日序 Dayline" },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f7f7f5" }, { media: "(prefers-color-scheme: dark)", color: "#111318" }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-HK" suppressHydrationWarning>
      <body><PwaRegister />{children}</body>
    </html>
  );
}
