import type { HTMLAttributes } from "react";
import { cn } from "@multiterm/pluto-ui";
import wordmarkUrl from "./assets/dotbase-wordmark.svg";
import markUrl from "./assets/dotbase-mark.svg";

export interface DotbaseBrandProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "wordmark" | "mark";
}

export function DotbaseBrand({ variant = "wordmark", className, ...props }: DotbaseBrandProps) {
  const mark = variant === "mark";
  return (
    <span
      aria-label="Dotbase"
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

export const DotbaseWatermark = DotbaseBrand;

/** @deprecated Use DotbaseBrand. */
export const PlutoWatermark = DotbaseBrand;
