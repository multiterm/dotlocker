import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("block text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground", className)}
    {...props}
  />
));
Label.displayName = "Label";
