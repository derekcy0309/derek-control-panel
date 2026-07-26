import * as React from "react";

export type DueSoonEmailItem = {
  id: string;
  kind: string;
  title: string;
  area: "personal" | "family" | "work";
  dueDate: string;
  nextAction: string | null;
};

export function DueSoonDigestEmail({
  displayName,
  items,
  horizonDays,
  appUrl
}: {
  displayName: string;
  items: DueSoonEmailItem[];
  horizonDays: number;
  appUrl: string;
}) {
  return (
    <html lang="zh-HK">
      <body style={body}>
        <div style={preview}>
          {items.length ? `未來 ${horizonDays} 日有 ${items.length} 項事情值得預先留意` : `未來 ${horizonDays} 日暫時沒有到期事項`}
        </div>
        <main style={container}>
          <p style={eyebrow}>DEREK CONTROL PANEL</p>
          <h1 style={heading}>{displayName}，呢封係溫和預覽</h1>
          <p style={intro}>
            {items.length
              ? `未來 ${horizonDays} 日有 ${items.length} 項到期事項。唔需要一次過完成；先打開系統，揀一個最細下一步就夠。`
              : `未來 ${horizonDays} 日暫時沒有到期事項。今日可以按實際能量同家庭需要安排，毋須為清單製造額外壓力。`}
          </p>
          <section style={list}>
            {items.length ? items.map((item) => (
              <section key={`${item.kind}-${item.id}`} style={card}>
                <p style={meta}>{areaLabel(item.area)} · {formatDate(item.dueDate)}</p>
                <p style={title}>{item.title}</p>
                {item.nextAction ? <p style={next}>下一步：{item.nextAction}</p> : null}
              </section>
            )) : (
              <section style={emptyCard}>
                <p style={title}>三日內未有到期事項</p>
                <p style={next}>可以保留緩衝、休息，或者只推進一個最有幫助嘅小步。</p>
              </section>
            )}
          </section>
          <a href={`${appUrl.replace(/\/$/, "")}/`} style={button}>打開今日計劃</a>
          <p style={footer}>
            呢封電郵只係預覽，唔代表你今日要做晒。私人項目只寄去項目所屬用戶嘅登入電郵。
          </p>
        </main>
      </body>
    </html>
  );
}

function areaLabel(area: DueSoonEmailItem["area"]) {
  return area === "family" ? "家庭" : area === "work" ? "工作" : "個人";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${value}T12:00:00+08:00`));
}

const body: React.CSSProperties = {
  backgroundColor: "#f4f6fb",
  color: "#182033",
  fontFamily: "Arial, 'PingFang HK', 'Microsoft JhengHei', sans-serif",
  margin: 0,
  padding: "28px 12px"
};
const preview: React.CSSProperties = {
  display: "none",
  fontSize: "1px",
  lineHeight: "1px",
  maxHeight: 0,
  maxWidth: 0,
  opacity: 0,
  overflow: "hidden"
};
const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "20px",
  margin: "0 auto",
  maxWidth: "600px",
  padding: "32px"
};
const eyebrow: React.CSSProperties = { color: "#5b5bd6", fontSize: "12px", fontWeight: "700", letterSpacing: "1.4px" };
const heading: React.CSSProperties = { fontSize: "26px", lineHeight: "1.25", margin: "8px 0 10px" };
const intro: React.CSSProperties = { color: "#667085", fontSize: "15px", lineHeight: "1.7", margin: "0 0 22px" };
const list: React.CSSProperties = { margin: "0 0 22px" };
const card: React.CSSProperties = {
  backgroundColor: "#f8f9fc",
  border: "1px solid #e9eaf0",
  borderRadius: "14px",
  margin: "0 0 10px",
  padding: "14px 16px"
};
const emptyCard: React.CSSProperties = {
  ...card,
  backgroundColor: "#ecfdf5",
  border: "1px solid #a7f3d0"
};
const meta: React.CSSProperties = { color: "#777f91", fontSize: "12px", fontWeight: "700", margin: "0 0 5px" };
const title: React.CSSProperties = { color: "#182033", fontSize: "16px", fontWeight: "700", lineHeight: "1.5", margin: 0 };
const next: React.CSSProperties = { color: "#566074", fontSize: "13px", lineHeight: "1.6", margin: "7px 0 0" };
const button: React.CSSProperties = {
  backgroundColor: "#5b5bd6",
  borderRadius: "12px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "700",
  padding: "12px 20px",
  textDecoration: "none"
};
const footer: React.CSSProperties = { color: "#8a91a1", fontSize: "12px", lineHeight: "1.6", margin: "22px 0 0" };
