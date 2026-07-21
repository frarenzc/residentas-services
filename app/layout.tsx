import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Residentas Guest Services",
  description: "Book airport transfers and tuk-tuk tours for your Residentas stay.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
