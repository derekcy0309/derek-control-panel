import type { Metadata } from "next";
import { AuthGate } from "@/components/AuthGate";
import { ReadingRoom } from "@/components/dayline/ReadingRoom";

export const metadata: Metadata = { title: "資訊站" };

export default function Briefing() {
  return <AuthGate><ReadingRoom /></AuthGate>;
}
