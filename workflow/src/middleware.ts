import { NextRequest, NextResponse } from "next/server";

// Workflow editor je samostatná aplikace s placeným API (OpenRouter). Veřejně
// dostupný by mohl utrácet kredit komukoli z internetu, proto je celý chráněný
// heslem z prostředí (HTTP Basic).
//
// WORKFLOW_PASSWORD nastav v prostředí. Bez něj je aplikace v produkci
// nepřístupná (fail closed); v developmentu zůstává otevřená pro pohodlný vývoj.

const REALM = "Mulen Nano Workflow";

function unauthorized(): NextResponse {
  return new NextResponse("Přihlášení je vyžadováno.", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

/** Porovnání v konstantním čase, aby nešlo heslo uhádnout podle odezvy. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

/** Dekóduje hlavičku Authorization bez Node-only API, aby fungovala i na Edge. */
function decodePayload(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const expected = String(process.env.WORKFLOW_PASSWORD || "").trim();

  if (!expected) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Workflow není nakonfigurovaný (chybí WORKFLOW_PASSWORD).", { status: 503 });
  }

  const match = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  if (match) {
    const decoded = decodePayload(match[1]);
    if (decoded !== null) {
      const separator = decoded.indexOf(":");
      const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
      if (safeEqual(password, expected)) return NextResponse.next();
    }
  }

  return unauthorized();
}

// Chráníme vše; statické soubory Next obsluhuje přes _next a ty zůstávají volné.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"],
};
