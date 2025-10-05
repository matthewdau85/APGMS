import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "APGMS Operator Console",
  description: "Prototype operator UI for reconciliation queues",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-brand-surface">
        {children}
      </body>
    </html>
  );
}
