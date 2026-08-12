import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/** Theme-aware shadcn-style loading placeholder. Size it with className. */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="skeleton"
    aria-hidden="true"
    className={cn(
      "animate-pulse rounded-[var(--pl-radius-xs)] bg-[color-mix(in_srgb,var(--pl-primary)_10%,var(--pl-surface-2))]",
      className,
    )}
    {...props}
  />
));
Skeleton.displayName = "Skeleton";
