import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Silent Auction Dashboard",
  description: "Live silent auction dashboard for the company picnic.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
