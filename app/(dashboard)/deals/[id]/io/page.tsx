import { deals, getShowById, getIOByDeal, profiles } from "@/lib/data";
import { notFound } from "next/navigation";
import IOGeneratorForm from "@/components/io/IOGeneratorForm";

export default async function IOPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deal = deals.find((d) => d.id === id);
  if (!deal) notFound();

  const show = getShowById(deal.show_id);
  if (!show) notFound();

  const existingIO = getIOByDeal(deal.id);
  const brand = profiles.find((p) => p.id === deal.brand_id);
  const agency = deal.agency_id ? profiles.find((p) => p.id === deal.agency_id) : undefined;
  const agent = deal.agent_id ? profiles.find((p) => p.id === deal.agent_id) : undefined;

  return (
    <IOGeneratorForm
      deal={deal}
      show={show}
      existingIO={existingIO}
      brand={brand!}
      agency={agency}
      agent={agent}
    />
  );
}
