import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  density?: "compact" | "regular" | "spacious";
}

const padding = { compact: "p-4", regular: "p-5", spacious: "p-6" } as const;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, density = "regular", ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "rounded-[var(--pl-radius-sm)] border border-[var(--pl-line)] bg-[var(--pl-elevated)] text-[var(--pl-text)] shadow-pluto",
        padding[density],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("space-y-1.5", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("m-0 text-base font-semibold tracking-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("m-0 text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("pt-2", className)} {...props} />
));
CardContent.displayName = "CardContent";
