const hongKongDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});

const hongKongWeekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
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
  const dateParts = Object.fromEntries(
    hongKongDateFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    dateLabel: `${dateParts.day}/${dateParts.month}/${dateParts.year} (${hongKongWeekdayFormatter.format(value)})`,
    timeLabel: hongKongTimeFormatter.format(value),
    iso: value.toISOString()
  };
}
