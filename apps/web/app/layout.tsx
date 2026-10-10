/**
 * Root layout for the entire application.
 * Loads Inter from Google Fonts and sets global metadata defaults.
 * Dark mode is admin-only and lives in app/(admin)/_components/AdminThemeScope.tsx,
 * deliberately NOT here: a class on <html> would reach the public site.
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
    default: "SuperHeroCPR | AHA-Certified CPR Training in the Bay Area, Florida",
    template: "%s | SuperHeroCPR",
  },
  description:
    "AHA-certified CPR, BLS, and First Aid training in the Bay Area, Florida. Book a class today.",
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
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
