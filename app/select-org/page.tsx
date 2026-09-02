import { OrganizationList } from "@clerk/nextjs";

export default function SelectOrgPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <OrganizationList
        hidePersonal
        afterSelectOrganizationUrl="/w"
        afterCreateOrganizationUrl="/w"
      />
    </div>
  );
}
