import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement>;

/** Native scroll container with the active Pluto theme's scrollbar treatment. */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} data-slot="scroll-area" className={cn("pl-scrollbar overflow-auto", className)} {...props} />
  ),
);
ScrollArea.displayName = "ScrollArea";
