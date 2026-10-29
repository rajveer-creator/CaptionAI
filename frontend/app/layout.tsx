
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CaptionAI — AI Caption Generator",
  description:
    "Generate creative social media captions with AI for Instagram, YouTube, Facebook and LinkedIn.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
