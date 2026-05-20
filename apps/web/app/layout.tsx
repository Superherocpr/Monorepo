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
         * Dark mode flash prevention: reads localStorage before first paint and
         * adds the 'dark' class to <html> if the user's preference is dark.
         * Must live in the root layout <head> as a dangerouslySetInnerHTML script —
         * this renders as raw HTML in the server stream before React hydrates, so it
         * runs synchronously before any paint. next/script beforeInteractive is not
         * supported in nested layouts, which is why it lives here.
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
