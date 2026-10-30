import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/** The "Filled" text box: no outline at rest, a lighter fill, an ember ring on
 *  focus and a destructive ring when invalid. Height, not vertical padding,
 *  sets the size (44px is about 11px above and below the text), so a call site
 *  with its own h-* stays centred. A call site's own bg-*, rounded-*, h-*, px-*
 *  or ring-* replaces these through cn, so nothing here is a dark: variant. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-(--radius-field) bg-input px-3.5 text-base transition-[background-color,box-shadow] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ember disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
