import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wacana Haji — Dashboard DNA",
  description: "Eksplorasi korpus dan jaringan wacana pembiayaan haji Indonesia, 2021–2024.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
