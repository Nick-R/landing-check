import { NextResponse } from "next/server";
import { clientIp, hashIp } from "@/lib/limits";
import { runCheck } from "@/lib/runCheck";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Не получилось отправить. Попробуйте ещё раз." }, { status: 400 });
  }
  try {
    const result = await runCheck(body, hashIp(clientIp(request.headers)));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (e) {
    console.error("check failed", e);
    return NextResponse.json({ error: "Что-то сломалось на нашей стороне. Попробуйте ещё раз." }, { status: 500 });
  }
}
