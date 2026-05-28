import { CapexProvider } from "@/lib/capexContext"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <CapexProvider>{children}</CapexProvider>
}
