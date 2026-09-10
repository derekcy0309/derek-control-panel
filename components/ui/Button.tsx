import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" && "button-primary",
        variant === "secondary" && "button-secondary",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "button-ghost",
        variant === "success" && "bg-emerald-600 text-white hover:bg-emerald-700",
        className
      )}
      {...props}
    />
  );
}
