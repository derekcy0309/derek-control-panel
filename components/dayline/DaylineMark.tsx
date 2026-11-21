// The same page-stack mark on the dashboard, sign-in card and inner navigation.
export function DaylineMark({ standard = false }: { standard?: boolean }) {
  return <span className={standard ? "dl-monogram dl-mark-standard" : "dl-monogram"} aria-hidden="true"><b/><b/><b/></span>;
}
