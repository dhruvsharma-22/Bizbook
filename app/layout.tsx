
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WorkspaceScopeRootProvider from "@/components/layout/WorkspaceScopeRootProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BizBook | Institute Management",
  description: "Financial and institute management for coaching businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense fallback={<div className="min-h-screen bg-slate-50" aria-busy="true" />}>
          <WorkspaceScopeRootProvider>
            <div className="bizbook-application">{children}</div>
          </WorkspaceScopeRootProvider>
        </Suspense>
      </body>
    </html>
  );
}
