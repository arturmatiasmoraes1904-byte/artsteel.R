"use client"

import * as React from "react"
import { Switch as BaseSwitch } from "@base-ui/react/switch"
import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        "peer group/switch inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-[#22c55e] data-[unchecked]:bg-[#d4d4d8] dark:data-[unchecked]:bg-[#3f3f46]",
        className
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-all duration-300",
          "group-active/switch:w-7",
          "data-[unchecked]:translate-x-0",
          "data-[checked]:translate-x-5 group-active/switch:data-[checked]:translate-x-[0.75rem]"
        )}
      />
    </BaseSwitch.Root>
  )
}

export { Switch }
