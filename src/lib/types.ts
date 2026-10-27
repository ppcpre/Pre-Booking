export type Role = "ADMIN" | "MANAGER" | "FRONT_DESK" | "ACCOUNTANT";
export type RentalMode = "DAILY" | "YEARLY";
export type PropertyStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type PropertyType = "APARTMENT" | "HOTEL" | "HOUSE" | "CONDO" | "OTHER";
export type UnitStatus = "ACTIVE" | "MAINTENANCE" | "INACTIVE";

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  FRONT_DESK: "Front desk",
  ACCOUNTANT: "Accountant",
};

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  APARTMENT: "Apartment",
  HOTEL: "Hotel",
  HOUSE: "House",
  CONDO: "Condo",
  OTHER: "Other",
};

export type Property = {
  id: string;
  code: string;
  name: string;
  type: PropertyType;
  status: PropertyStatus;
  address: string | null;
  phone: string | null;
  photo_path: string | null;
  check_in_time: string;
  check_out_time: string;
  meter_reading_day: number;
  grace_days: number;
  payment_instructions: string | null;
};

export type TeamMember = {
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  user_id: string | null;
  added_at: string;
  last_sign_in: string | null;
};

export type RoomType = {
  id: string;
  property_id: string;
  name: string;
  max_occupancy: number;
  size_sqm: number | null;
  amenities: string[];
};

export type Unit = {
  id: string;
  property_id: string;
  room_type_id: string;
  code: string;
  floor: string | null;
  allowed_modes: RentalMode[];
  status: UnitStatus;
};

export type RatePlan = {
  id: string;
  room_type_id: string;
  mode: RentalMode;
  base_amount: number;
  weekend_amount: number | null;
  min_length: number;
  max_length: number | null;
  deposit_months: number | null;
  advance_months: number | null;
  cancellation_policy_id: string | null;
};

export type ActionResult = { ok?: boolean; error?: string; message?: string };
