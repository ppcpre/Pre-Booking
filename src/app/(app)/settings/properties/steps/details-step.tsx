import { ActionForm, InlineAction } from "@/components/action-form";
import { getProperty } from "@/lib/properties";
import { signedPhotoUrls } from "@/lib/photos";
import { removePropertyPhoto, setPropertyStatus, updateDetails } from "../actions";
import { DetailsFields } from "./details-fields";
import { NextStep } from "./next-link";
import { PhotoUploader } from "./photo-uploader";

export async function DetailsStep({ propertyCode }: { propertyCode: string }) {
  const p = await getProperty(propertyCode);
  const urls = await signedPhotoUrls([p.photo_path]);
  return (
    <>
      <div className="card">
        <PhotoUploader propertyId={p.id} name={p.name} url={p.photo_path ? urls[p.photo_path] ?? null : null} />
        {p.photo_path && (
          <div><InlineAction action={removePropertyPhoto} fields={{ property_id: p.id }} label="Remove photo" className="btn sm quiet" /></div>
        )}
      </div>
      <ActionForm action={updateDetails} footer={<NextStep code={p.code} from="details" />}>
        <input type="hidden" name="property_id" value={p.id} />
        <DetailsFields p={p} />
      </ActionForm>
      {p.status === "ACTIVE" && (
        <div className="card">
          <h2>Archive property <span>Hides it from the overview. Existing data stays.</span></h2>
          <div><InlineAction action={setPropertyStatus} fields={{ property_id: p.id, status: "ARCHIVED" }} label="Archive" className="btn danger" confirmText={`Archive ${p.name}?`} /></div>
        </div>
      )}
      {p.status === "ARCHIVED" && (
        <div className="card">
          <h2>This property is archived</h2>
          <div><InlineAction action={setPropertyStatus} fields={{ property_id: p.id, status: "DRAFT" }} label="Restore as draft" className="btn" /></div>
        </div>
      )}
    </>
  );
}
