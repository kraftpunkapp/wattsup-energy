import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-8">
        <Logo size={40} />
        {children}
      </div>
    </main>
  );
}
