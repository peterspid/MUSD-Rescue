import type { Metadata } from "next";
import { parsePositionId } from "@/lib/positions/id";
import { InvalidId, PositionView } from "@/components/position-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = parsePositionId(id);
  return { title: p.kind === "live" ? `Rescue ${p.owner.slice(0, 8)}…${p.owner.slice(-4)}` : "Rescue" };
}

export default async function RescuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = parsePositionId(id);
  if (p.kind !== "live") return <InvalidId raw={id} />;
  return <PositionView owner={p.owner} focus="rescue" />;
}
