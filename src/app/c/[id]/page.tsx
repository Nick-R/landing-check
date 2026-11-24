import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCheck } from "@/lib/checks";
import { Report } from "./Report";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const check = await getCheck(id);
  return { title: check ? `${check.score}/100 - ${hostOf(check.finalUrl)} - Сверка` : "Проверка не найдена" };
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await getCheck(id);
  if (!check) notFound();
  return <Report check={check} host={hostOf(check.finalUrl)} />;
}
