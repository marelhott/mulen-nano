import { NextResponse } from "next/server";

export interface EnvStatusResponse {
  openRouter: boolean;
}

export async function GET() {
  // Avoid exposing provider secret presence in production unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.EXPOSE_ENV_STATUS !== "1") {
    return NextResponse.json<EnvStatusResponse>({
      openRouter: false,
    });
  }

  const status: EnvStatusResponse = {
    openRouter: !!process.env.OPENROUTER_API_KEY,
  };

  return NextResponse.json(status);
}
