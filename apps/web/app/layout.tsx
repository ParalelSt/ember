import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { createClient } from '@/lib/pocketbase/server';
import { AuthProvider, type AuthUser } from '@/components/providers/AuthProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { LoggerInit } from '@/components/LoggerInit';
import { VersionLog } from '@/components/VersionLog';
import { RegisterSW } from '@/components/RegisterSW';
import { BugReportDialog } from '@/components/BugReportDialog';
import { Toaster } from '@/components/ui/sonner';
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

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0e1014' },
    { color: '#ff5a3a' },
  ],
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pb = await createClient();
  const initialUser: AuthUser | null = pb.authStore.isValid && pb.authStore.record
    ? {
        id: pb.authStore.record.id,
        email: String(pb.authStore.record.email ?? ''),
        name: String(pb.authStore.record.name ?? ''),
        avatarUrl: pb.authStore.record.avatar
          ? pb.files.getURL(pb.authStore.record, pb.authStore.record.avatar as string)
          : null,
        isAdmin: pb.authStore.record.is_admin === true,
      }
    : null;

  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Portrait-only on phones — shown over the app when a phone is turned
            landscape (the layout is built for portrait). CSS-gated in
            globals.css; inert on tablets/desktop. */}
        <div className="rotate-lock">
          <p className="text-lg font-semibold">Rotate your phone to portrait</p>
          <p className="text-sm text-muted-foreground">Ember is built for portrait on phones.</p>
        </div>
        <QueryProvider>
          <AuthProvider initialUser={initialUser}>
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
