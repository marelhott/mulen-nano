import { NextRequest, NextResponse } from "next/server";

// Workflow editor je samostatná aplikace s placenými API (OpenRouter) a přístupem
// k lokálnímu disku. Veřejně dostupný by mohl utrácet kredit komukoli z internetu,
// proto je celý chráněný heslem z prostředí (HTTP Basic).
//
// WORKFLOW_PASSWORD nastav v prostředí. Bez něj je aplikace v produkci nepřístupná
// (fail closed) a v developmentu zůstává otevřená pro pohodlný vývoj.

const REALM = "Mulen Nano Workflow";

function unauthorized(): NextResponse {
  return new NextResponse("Přihlášení je vyžadováno.", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(request: NextRequest) {
  const expected = String(process.env.WORKFLOW_PASSWORD || "").trim();

  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Workflow není nakonfigurovaný (chybí WORKFLOW_PASSWORD).", { status: 503 });
  }

  const header = request.headers.get("authorization") || "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (match) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
      if (safeEqual(password, expected)) return NextResponse.next();
    } catch {
      // neplatný base64 -> spadne na 401 níže
    }
  }

  return unauthorized();
}

// Chráníme vše kromě statických souborů, které Next obsluhuje sám.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
