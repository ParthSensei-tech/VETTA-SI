import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/shared/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[background-color,color,box-shadow,transform,opacity,filter] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:not-disabled:scale-[0.97]",
  {
    variants: {
      variant: {
        // Hick's Law: Primary CTA commands immediate visual hierarchy with radiant lime glow and elevated border
        default:
          "soft-lime text-primary-foreground font-semibold shadow-lime ring-1 ring-lime-400/50 hover:brightness-[1.08] hover:shadow-[0_12px_30px_-8px_rgba(198,244,50,0.7)]",
        secondary:
          "glass text-fg hover:bg-[var(--glass-fill-strong)] hover:shadow-[var(--shadow-soft-3),var(--shadow-inset)]",
        outline:
          "border border-border bg-field text-fg shadow-[var(--field-inset)] backdrop-blur-[8px] hover:bg-elevated",
        ghost: "text-muted hover:bg-[var(--glass-fill-strong)] hover:text-fg",
        destructive: "bg-danger text-white shadow-[var(--shadow-soft-1)] hover:bg-danger/90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        // Fitts's Law: Minimum 44px hit target across default and icon sizes
        default: "h-11 min-h-[44px] px-4",
        sm: "h-9 min-h-[36px] rounded-lg px-3 text-xs",
        lg: "h-12 min-h-[48px] rounded-xl px-6 text-base font-semibold",
        icon: "size-11 min-w-[44px] min-h-[44px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

// buttonVariants is the CVA companion for the Button component.
// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants };
