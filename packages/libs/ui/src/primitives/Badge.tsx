import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: "default" | "secondary" | "success" | "destructive";
}

const variants = {
  default: "border-primary/30 bg-primary/15 text-primary-foreground",
  secondary: "border-border bg-secondary text-secondary-foreground",
  success: "border-emerald-400/30 bg-emerald-400/15 text-emerald-100",
  destructive: "border-destructive/30 bg-destructive/15 text-destructive-foreground",
} as const;

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = "Badge";
