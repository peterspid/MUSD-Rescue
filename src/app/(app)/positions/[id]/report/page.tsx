import type { Metadata } from "next";
import { parsePositionId } from "@/lib/positions/id";
import { InvalidId } from "@/components/position-view";
import { ReportView } from "@/components/report-view";

export const metadata: Metadata = { title: "Risk report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = parsePositionId(id);
  if (p.kind !== "live") return <InvalidId raw={id} />;
  return <ReportView owner={p.owner} />;
}
