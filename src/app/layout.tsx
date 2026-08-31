import type { Metadata, Viewport } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const DESCRIPTION =
  "StateGen is the CRM built for Lebanese real estate agencies — smart property matching, a shared client & deal pipeline, and a WhatsApp assistant.";

export const metadata: Metadata = {
  metadataBase: new URL("https://stategenapp.vercel.app"),
  title: {
    default: "StateGen — Real estate CRM",
    template: "%s · StateGen",
  },
  description: DESCRIPTION,
  applicationName: "StateGen",
  openGraph: {
    type: "website",
    siteName: "StateGen",
    title: "StateGen — Real estate CRM",
    description: DESCRIPTION,
    url: "/",
    images: [{ url: "/logo.png", width: 512, height: 512, alt: "StateGen" }],
  },
  twitter: {
    card: "summary",
    title: "StateGen — Real estate CRM",
    description: DESCRIPTION,
    images: ["/logo.png"],
  },
  // PWA: home-screen icon + iOS standalone behaviour. The web manifest is served
  // automatically from src/app/manifest.ts.
  icons: {
    icon: "/icon.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "StateGen",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E1F3D",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} h-full antialiased`}
      style={{ fontFamily: 'var(--font-public-sans), -apple-system, BlinkMacSystemFont, sans-serif' }}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
