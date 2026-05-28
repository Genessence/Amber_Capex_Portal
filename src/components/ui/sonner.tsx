"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        style: { fontFamily: "inherit" },
      }}
      {...props}
    />
  )
}

export { Toaster }
