import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/PwaRegister";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Derek Control Panel", template: "%s · Derek Control Panel" },
  description: "私人、家庭及公司日常作業系統",
  applicationName: "Derek Control Panel",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Control Panel" },
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
