import { Sidebar } from "@/components/Sidebar"
import { TopNav } from "@/components/TopNav"
import { LoginGate } from "@/components/LoginGate"
import { CapexProvider } from "@/lib/capexContext"

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CapexProvider>
      <LoginGate>
        <div className="flex h-screen overflow-hidden max-w-full" style={{ background: "#F2F4F7" }}>
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopNav />
            <main className="flex-1 overflow-y-auto w-full">
              {children}
            </main>
          </div>
        </div>
      </LoginGate>
    </CapexProvider>
  )
}
