import "./globals.css";

export const metadata = {
  title: "AgentOS Memory Lab",
  description: "Branching memory state explorer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen w-screen bg-[#09090b] text-[#fafafa] flex overflow-hidden">
        {children}
      </body>
    </html>
  );
}
