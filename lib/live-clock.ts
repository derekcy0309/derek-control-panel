const hongKongDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
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
    dateKey: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    dateLabel: `${dateParts.day}/${dateParts.month}/${dateParts.year.slice(-2)} (${dateParts.weekday})`,
    isSunday: dateParts.weekday === "Sun",
    timeLabel: hongKongTimeFormatter.format(value),
    iso: value.toISOString()
  };
}
