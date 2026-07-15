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
  const response = await context.next();
  const url = new URL(context.request.url);
  const ext = url.pathname.split(".").pop().toLowerCase();

  if (url.pathname.startsWith("/fonts/") && FONT_MIME[ext]) {
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Content-Type", FONT_MIME[ext]);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  return response;
}
