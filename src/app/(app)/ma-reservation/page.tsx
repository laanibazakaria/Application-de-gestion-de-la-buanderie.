import { getTranslations } from "next-intl/server";

import { MyReservation } from "@/components/laundry/my-reservation";
import { requirePageUser } from "@/server/auth/page-auth";

export default async function MyReservationPage() {
  await requirePageUser({ role: "student" });
  const t = await getTranslations("mine");
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 text-2xl font-bold">{t("title")}</h1>
      <MyReservation />
    </div>
  );
}
