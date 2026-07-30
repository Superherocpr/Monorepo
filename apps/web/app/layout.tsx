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
      <head>
        {/*
         * Dark mode flash prevention: reads localStorage before first paint and
         * adds the 'dark' class to <html> if the user's preference is dark.
         *
         * This MUST stay a raw <script> with dangerouslySetInnerHTML. It renders
         * into the server HTML stream and executes synchronously before first
         * paint, which is the only way to avoid a light-mode flash.
         *
         * Do NOT convert this to next/script beforeInteractive: in the App Router
         * that strategy wraps the code in a `self.__next_s` queue executed later by
         * Next's runtime, which reintroduces the flash it exists to prevent.
         *
         * React 19 logs a dev-only console warning here ("Encountered a script tag
         * while rendering React component") whenever it re-creates this node on the
         * client. The warning is expected, fires once per session, and does not
         * appear in production builds — the script itself works correctly.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
