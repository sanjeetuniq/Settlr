import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SETTLR — good company, clear balances",
  description:
    "Keep shared expenses, group balances, and settle-up suggestions together.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
