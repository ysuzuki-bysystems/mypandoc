import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mypandoc",
  description: "mypandoc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-primary text-primary-foreground">{children}</body>
    </html>
  );
}
