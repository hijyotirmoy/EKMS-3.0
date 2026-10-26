import { NextResponse } from "next/server";

export async function GET() {
  const content = `
    self.addEventListener('install', (e) => {
      self.skipWaiting();
    });
    self.addEventListener('activate', (e) => {
      self.registration.unregister().then(() => {
        return self.clients.matchAll({ type: 'window' });
      }).then((clients) => {
        for (const client of clients) {
          client.navigate(client.url);
        }
      });
    });
  `;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    },
  });
}
