import Image from "next/image";
import styles from "./reading-room.module.css";

export type EditorialArt = "medical" | "market" | "gadgets";

export function EditorialCover({ art, eager = false }: { art: EditorialArt; eager?: boolean }) {
  return (
    <div className={styles.art} data-art={art} aria-hidden="true">
      <Image
        alt=""
        src={`/dayline-editorial/${art}.webp`}
        fill
        unoptimized
        loading={eager ? "eager" : "lazy"}
        sizes="(max-width: 680px) 100vw, 50vw"
      />
    </div>
  );
}
