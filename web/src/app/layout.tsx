import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TechnoFunda — US equity research",
  description: "Technical + fundamental screening. Research and education, not investment advice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

/** Runs before first paint: applies the saved theme so there's no flash. */
const NO_FLASH = `
(function(){try{
  var t = localStorage.getItem('tf-theme');
  if(!t){ t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  document.documentElement.setAttribute('data-theme', t);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
