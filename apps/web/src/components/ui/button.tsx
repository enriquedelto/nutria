import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background,color,transform,box-shadow] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-herb text-herb-ink shadow-sm hover:brightness-110",
        accent: "bg-persimmon text-white shadow-sm hover:brightness-105",
        outline: "border border-line bg-card hover:bg-paper-2",
        ghost: "hover:bg-paper-2",
        soft: "bg-herb-soft text-herb hover:brightness-95",
        danger: "bg-danger text-white hover:brightness-110",
        link: "text-herb underline-offset-4 hover:underline rounded-none",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base", icon: "size-10", "icon-sm": "size-8" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({ className, variant, size, asChild, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
