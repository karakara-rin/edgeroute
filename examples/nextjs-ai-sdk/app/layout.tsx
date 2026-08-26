export const metadata = {
  title: 'EdgeRoute + Vercel AI SDK Demo',
  description: 'Zero-latency dynamic LLM routing & semantic caching on Next.js Edge',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'sans-serif', margin: 0, padding: '2rem', background: '#0a0a0c', color: '#f0f0f5' }}>
        {children}
      </body>
    </html>
  );
}
