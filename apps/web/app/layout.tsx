import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { createClient } from '@/lib/pocketbase/server';
import { fileUrl } from '@/lib/pocketbase/fileUrl';
import { AuthProvider, type AuthUser } from '@/components/providers/AuthProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { LoggerInit } from '@/components/LoggerInit';
import { VersionLog } from '@/components/VersionLog';
import { RegisterSW } from '@/components/RegisterSW';
import { BugReportDialog } from '@/components/BugReportDialog';
import { Toaster } from '@/components/ui/sonner';
import { ThemeApplier } from '@/components/providers/ThemeApplier';
import { themeFromRecord } from '@/lib/theme/fromRecord';
import { htmlProps, themeColor } from '@/lib/theme/css';
import { DEFAULT_THEME, type ThemeDoc } from '@/lib/theme/model';
import './globals.css';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ember — Music',
  description: 'Music streaming.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Ember', statusBarStyle: 'black-translucent' },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
};

/** The signed-in person's active theme from the pb_auth cookie record
 *  (lib/theme/fromRecord.ts); null when signed out, so signed-out pages
 *  (/auth, /privacy, /terms) are Ember. */
async function cookieTheme(): Promise<ThemeDoc | null> {
  const pb = await createClient();
  return pb.authStore.isValid ? themeFromRecord(pb.authStore.record) : null;
}

/** theme-color is the theme's background, so the browser's bars match the
 *  page from the first byte (ThemeApplier keeps it current after that). */
export async function generateViewport(): Promise<Viewport> {
  return {
    themeColor: themeColor((await cookieTheme()) ?? DEFAULT_THEME),
    width: 'device-width',
    initialScale: 1,
    userScalable: false,
    viewportFit: 'cover',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pb = await createClient();
  const initialUser: AuthUser | null = pb.authStore.isValid && pb.authStore.record
    ? {
        id: pb.authStore.record.id,
        email: String(pb.authStore.record.email ?? ''),
        name: String(pb.authStore.record.name ?? ''),
        avatarUrl: pb.authStore.record.avatar
          ? fileUrl(pb.authStore.record, pb.authStore.record.avatar as string)
          : null,
        isAdmin: pb.authStore.record.is_admin === true,
      }
    : null;
  // The theme goes into the first HTML byte as inline variables on <html>:
  // no theme script, nothing to race, no flash. Ember adds nothing at all.
  const theme = initialUser ? themeFromRecord(pb.authStore.record) : null;
  const html = htmlProps(inter.variable, theme ?? DEFAULT_THEME);

  return (
    <html lang="en" className={html.className} style={html.style as React.CSSProperties} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Portrait-only on phones — shown over the app when a phone is turned
            landscape (the layout is built for portrait). CSS-gated in
            globals.css; inert on tablets/desktop. */}
        <div className="rotate-lock">
          <p className="text-lg font-semibold">Rotate your phone to portrait</p>
          <p className="text-meta">Ember is built for portrait on phones.</p>
        </div>
        <QueryProvider>
          <AuthProvider initialUser={initialUser}>
            <ThemeApplier initial={theme} stripped={initialUser !== null && theme === null} />
            <LoggerInit />
            <VersionLog />
            <RegisterSW />
            <PlayerProvider>
              <AppErrorBoundary>{children}</AppErrorBoundary>
            </PlayerProvider>
          </AuthProvider>
          <BugReportDialog />
        </QueryProvider>
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
