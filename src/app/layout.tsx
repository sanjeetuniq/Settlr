import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SETTLR — settles settlements in style",
  description:
    "Keep shared expenses, group balances, and settle-up suggestions together.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body>{children}</body>
    </html>
  );
}
