import type { HTMLAttributes } from "react";
import { cn } from "@dotlocker/ui";
import wordmarkUrl from "./assets/dotlocker-wordmark.svg";
import markUrl from "./assets/dotlocker-mark.svg";

export interface DotlockerBrandProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "wordmark" | "mark";
}

export function DotlockerBrand({ variant = "wordmark", className, ...props }: DotlockerBrandProps) {
  const mark = variant === "mark";
  return (
    <span
      aria-label="dot.locker"
      className={cn("inline-flex shrink-0 items-center", className)}
      {...props}
    >
      <img
        src={mark ? markUrl : wordmarkUrl}
        alt=""
        aria-hidden="true"
        className={cn(
          "block dark:invert mode-dark:invert",
          mark ? "h-8 w-auto" : "h-5 w-auto max-w-[164px]",
        )}
      />
    </span>
  );
}

export const DotlockerWatermark = DotlockerBrand;

/** @deprecated Use DotlockerBrand. */
export const PlutoWatermark = DotlockerBrand;
