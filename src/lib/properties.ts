import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SetupStatus } from "@/lib/setup";
import type { Property, RatePlan, RoomType, Unit } from "@/lib/types";

const PROPERTY_COLUMNS =
  "id, code, name, type, status, address, phone, photo_path, check_in_time, check_out_time, meter_reading_day, grace_days, payment_instructions";

export type PropertySummary = Pick<Property, "id" | "code" | "name" | "status" | "type" | "photo_path"> & {
  unit_count: number;
};

/** Properties the signed-in person can see (RLS decides), archived ones last. */
export const listProperties = cache(async (): Promise<PropertySummary[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("properties")
    .select("id, code, name, status, type, photo_path, units(count)")
    .order("name");
  const rows = (data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    type: p.type,
    photo_path: p.photo_path,
    unit_count: (p.units as unknown as { count: number }[])?.[0]?.count ?? 0,
  })) as PropertySummary[];
  return rows.sort((a, b) => Number(a.status === "ARCHIVED") - Number(b.status === "ARCHIVED"));
});

export const getProperty = cache(async (code: string): Promise<Property> => {
  const supabase = await createClient();
  const { data } = await supabase.from("properties").select(PROPERTY_COLUMNS).eq("code", code.toUpperCase()).maybeSingle();
  if (!data) notFound();
  return data as Property;
});

export const getSetupStatus = cache(async (propertyId: string): Promise<SetupStatus> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("property_setup_status", { pid: propertyId });
  return data as SetupStatus;
});

export const getRoomTypes = cache(async (propertyId: string): Promise<RoomType[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("room_types").select("*").eq("property_id", propertyId).order("sort_order").order("name");
  return (data ?? []) as RoomType[];
});

export const getUnits = cache(async (propertyId: string): Promise<Unit[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("units").select("*").eq("property_id", propertyId);
  const units = (data ?? []) as Unit[];
  return units.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
});

export const getRatePlans = cache(async (roomTypeIds: string[]): Promise<RatePlan[]> => {
  if (roomTypeIds.length === 0) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("rate_plans").select("*").in("room_type_id", roomTypeIds);
  return (data ?? []) as RatePlan[];
});
