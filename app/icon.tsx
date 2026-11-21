import { daylineIcon } from "@/components/dayline/AppMark";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return daylineIcon(size.width);
}
