import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#171923", color: "white", fontSize: 242, fontWeight: 800, letterSpacing: "-0.08em" }}><div style={{ display: "flex", width: 356, height: 356, borderRadius: 108, alignItems: "center", justifyContent: "center", background: "#4f46e5", boxShadow: "0 36px 80px rgba(79,70,229,.35)" }}>D</div></div>, size);
}
