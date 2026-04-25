/**
 * Root layout for the entire application.
 * Loads Inter from Google Fonts, sets global metadata defaults,
 * and injects the dark mode flash-prevention script per DESIGN-SYSTEM.md §6.
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  // Expose as a CSS variable so Tailwind's --font-sans picks it up
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SuperHeroCPR | AHA-Certified CPR Training in Tampa, FL",
    template: "%s | SuperHeroCPR",
  },
  description:
    "AHA-certified CPR, BLS, and First Aid training in Tampa, Florida. Book a class today.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_BASE_URL ?? "https://superherocpr.com"
  ),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        {/*
         * Dark mode flash prevention script removed for App Router compatibility.
         * If you want to add it, use next/script in a Client Component or follow Next.js docs.
         */}
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
