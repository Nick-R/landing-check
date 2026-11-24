import { NextResponse } from "next/server";
import { setDecision } from "@/lib/checks";
import { parseDecision } from "@/lib/decisions";

export const runtime = "nodejs";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string; fixId: string }> }) {
  const { id, fixId } = await ctx.params;
  let body: { decision?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Не получилось отправить. Попробуйте ещё раз." }, { status: 400 });
  }
  const decision = parseDecision(body?.decision);
  if (decision === undefined) return NextResponse.json({ error: "Не получилось отправить. Попробуйте ещё раз." }, { status: 400 });
  try {
    const ok = await setDecision(id, Number(fixId), decision);
    if (!ok) return NextResponse.json({ error: "Правка не найдена" }, { status: 404 });
    return NextResponse.json({ decision });
  } catch (e) {
    console.error("decision failed", e);
    return NextResponse.json({ error: "Не удалось сохранить решение" }, { status: 500 });
  }
}
