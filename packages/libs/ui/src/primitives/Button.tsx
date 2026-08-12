import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "default" | "secondary" | "destructive" | "ghost";
  readonly size?: "sm" | "md" | "lg";
}

const variants = {
  default: "bg-primary text-primary-foreground hover:brightness-110",
  secondary: "border border-border bg-secondary text-secondary-foreground hover:bg-muted",
  destructive: "border border-destructive/60 bg-destructive/20 text-destructive-foreground hover:bg-destructive/30",
  ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
