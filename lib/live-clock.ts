const hongKongDateFormatter = new Intl.DateTimeFormat("zh-HK", {
  timeZone: "Asia/Hong_Kong",
  month: "short",
  day: "numeric",
  weekday: "short"
});

const hongKongTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function formatHongKongClock(value: Date) {
  return {
    dateLabel: hongKongDateFormatter.format(value),
    timeLabel: hongKongTimeFormatter.format(value),
    iso: value.toISOString()
  };
}
