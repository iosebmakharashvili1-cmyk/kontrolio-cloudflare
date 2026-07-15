// Cloudflare Pages ზოგჯერ static ფონტის ფაილებს (.otf/.ttf/.woff/.woff2)
// არასწორი Content-Type-ით აწვდის (მაგ. application/octet-stream),
// რის გამოც ბრაუზერის security sanitizer-ი უარყოფს მათ ჩატვირთვას
// ("downloadable font: rejected by sanitizer"). _headers ფაილი ამ
// პროექტზე საკმარისად საიმედოდ არ მუშაობდა (Functions-იანი Pages
// deploy-ის კონტექსტში), ამიტომ იგივეს root-level middleware აკეთებს
// პირდაპირ — ეს ყოველთვის მუშაობს, რადგან თავად Functions-ის
// runtime-ის ნაწილია.

const FONT_MIME = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const ext = url.pathname.split(".").pop().toLowerCase();
  const isFont = url.pathname.startsWith("/fonts/") && FONT_MIME[ext];

  const response = await context.next();

  if (!isFont) return response;

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Content-Type", FONT_MIME[ext]);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
  // დროებითი debug header — თუ ეს ჩანს Network tab-ში
  // response headers-ში, middleware მუშაობს; თუ არა, საერთოდ არ ეშვება.
  newHeaders.set("X-Font-MW", "applied");

  const buf = await response.arrayBuffer();
  return new Response(buf, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
