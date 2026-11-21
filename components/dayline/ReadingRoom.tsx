"use client";

import Link from "next/link";
import { ArrowUpRight, Bookmark, Settings2 } from "lucide-react";
import { EditorialCover } from "./EditorialCover";
import { useInfoChoices } from "./InfoChoices";
import styles from "./reading-room.module.css";

export function ReadingRoom() {
  const { prefs, ready, error, retry } = useInfoChoices();
  const journals = ready && !error && prefs.journals;
  const news = ready && !error && prefs.news;
  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>READING ROOM</p>
          <h1>資訊站</h1>
          <p className={styles.muted}>得閒先睇。只顯示你開咗嘅內容。</p>
        </div>
        {journals ? <Link href="/briefing/publications" prefetch={false} className={styles.outline}>全部刊物 <ArrowUpRight aria-hidden="true" /></Link> : null}
      </header>
      {!ready ? <p className={styles.empty} role="status">讀取你嘅資訊設定中…</p> : null}
      {error ? <div className={styles.empty} role="alert"><p>{error}</p><button type="button" onClick={retry} className={styles.outline}>重新讀取</button></div> : null}
      {ready && !error && !journals && !news ? (
        <section className={styles.empty}>
          <p className={styles.kicker}>由你揀</p>
          <h2>想睇咩，由你話事</h2>
          <p className={styles.muted}>刊物同公開新聞預設關閉。想睇嗰陣，先到資訊設定開啟。</p>
          <Link href="/briefing/preferences" prefetch={false} className={styles.primary}>揀想睇嘅資訊 <ArrowUpRight aria-hidden="true" /></Link>
        </section>
      ) : null}
      {journals ? (
        <section className={styles.feature} aria-labelledby="reading-feature-title">
          <EditorialCover art="medical" eager />
          <div className={styles.featureCopy}>
            <p className={styles.kicker}>健康與照護 / 刊物專題</p>
            <h2 id="reading-feature-title">醫療期刊</h2>
            <p>由香港社區照護，到全球慢病研究。</p>
            <Link href="/briefing/medical" prefetch={false} className={styles.primary}>睇期刊 <ArrowUpRight aria-hidden="true" /></Link>
          </div>
        </section>
      ) : null}
      {journals || news ? (
        <div className={styles.features}>
          {journals ? (
            <Link href="/briefing/evening" prefetch={false} className={styles.tile}>
              <EditorialCover art="market" />
              <p className={styles.kicker}>MARKET NOTES</p>
              <h2>美股晚報 <ArrowUpRight aria-hidden="true" /></h2>
              <p className={styles.muted}>大市同值得留意嘅變化，按出刊日閱讀。</p>
            </Link>
          ) : null}
          {news ? (
            <Link href="/briefing/gadgets" prefetch={false} className={styles.tile}>
              <EditorialCover art="gadgets" eager={!journals} />
              <p className={styles.kicker}>GADGETS</p>
              <h2>科技同裝置 <ArrowUpRight aria-hidden="true" /></h2>
              <p className={styles.muted}>手機、平板同日常好用嘅科技。</p>
            </Link>
          ) : null}
        </div>
      ) : null}
      <nav className={styles.roomLinks} aria-label="資訊站其他入口">
        {news ? <>
          <Link href="/briefing/local" prefetch={false}>香港新聞</Link>
          <Link href="/briefing/markets" prefetch={false}>市場新聞同指數</Link>
          <Link href="/briefing/care" prefetch={false}>居家護理市場</Link>
        </> : null}
        <Link href="/briefing/library" prefetch={false}><Bookmark aria-hidden="true" />我的網頁同收藏</Link>
        <Link href="/briefing/preferences" prefetch={false}><Settings2 aria-hidden="true" />資訊設定</Link>
      </nav>
    </div>
  );
}
