import { forwardRef, type ElementType, type HTMLAttributes, type JSX } from "react";
import { cn } from "../utils/cn";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: keyof JSX.IntrinsicElements;
  variant?: "body" | "title" | "page" | "label";
}

const variants = {
  body: "text-sm leading-6",
  title: "text-base font-semibold tracking-[-.015em]",
  page: "text-[26px] font-semibold leading-tight tracking-[-.025em]",
  label: "text-[11px] font-bold uppercase tracking-[.14em]",
} as const;

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ as = "p", variant = "body", className, ...props }, ref) => {
    const Component = as as ElementType;
    return <Component ref={ref} className={cn("m-0", variants[variant], className)} {...props} />;
  },
);
Text.displayName = "Text";
