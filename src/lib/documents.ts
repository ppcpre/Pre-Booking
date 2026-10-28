import "server-only";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type DocLine = { description: string; amount: number; period?: string };
export type Doc = {
  id: string;
  type: "INVOICE" | "RECEIPT";
  number: string;
  property_id: string;
  booking_id: string;
  payment_id: string | null;
  issue_date: string;
  due_date: string | null;
  issuer: { name: string; address: string | null; tax_id: string | null; phone: string | null; property: string; property_code: string; photo_path: string | null };
  bill_to: { name: string; attention: string | null; address: string | null; tax_id: string | null; branch: string | null; phone: string | null; email: string | null; unit: string; booking_code: string };
  lines: DocLine[];
  total: number;
  extra: Record<string, unknown> | null;
  status: "ISSUED" | "VOID";
  void_reason: string | null;
  created_at: string;
};

export async function listDocuments(propertyId: string, type: "INVOICE" | "RECEIPT" | null, limit = 100): Promise<Doc[]> {
  const supabase = await createClient();
  let q = supabase.from("documents").select("*").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(limit);
  if (type) q = q.eq("type", type);
  const { data } = await q;
  return (data ?? []) as Doc[];
}

export async function bookingDocuments(bookingId: string): Promise<Doc[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("*").eq("booking_id", bookingId).order("created_at", { ascending: false });
  return (data ?? []) as Doc[];
}

export async function getDocument(number: string): Promise<Doc> {
  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("*").eq("number", number).maybeSingle();
  if (!data) notFound();
  return data as Doc;
}
