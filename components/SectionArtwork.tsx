import { BriefcaseBusiness, HeartPulse, Home, Leaf, Sparkles, WalletCards } from "lucide-react";
import type { SectionIdentity } from "@/lib/appearance";

const icons = {
  today: Sparkles,
  family: Home,
  personal: Leaf,
  work: BriefcaseBusiness,
  finance: WalletCards,
  health: HeartPulse,
  system: Sparkles
} satisfies Record<SectionIdentity, typeof Sparkles>;

export function SectionArtwork({ section, compact = false }: { section: SectionIdentity; compact?: boolean }) {
  const Icon = icons[section];
  return (
    <div className={`section-art section-art-${section} ${compact ? "is-compact" : ""}`} aria-hidden="true">
      <span className="section-art-orbit section-art-orbit-one" />
      <span className="section-art-orbit section-art-orbit-two" />
      <span className="section-art-sun" />
      <span className="section-art-icon"><Icon /></span>
      <span className="section-art-leaf section-art-leaf-one" />
      <span className="section-art-leaf section-art-leaf-two" />
    </div>
  );
}
