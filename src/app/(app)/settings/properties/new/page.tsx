import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { requireRole } from "@/lib/session";
import { createProperty } from "../actions";
import { DetailsFields } from "../steps/details-fields";

export const metadata = { title: "Add property" };

export default async function NewProperty() {
  await requireRole("ADMIN", "MANAGER");
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div>
        <div className="crumb"><Link href="/settings/properties">Properties</Link> / New</div>
        <div className="head"><div><h1>Add property</h1><p>Just a name and a short code to start. Next: room types, units and rates — then you can open it. Photo, water/electricity prices and staff can come later.</p></div></div>
      </div>
      <ActionForm action={createProperty} submitLabel="Create and continue">
        <DetailsFields />
      </ActionForm>
    </div>
  );
}
