import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/admin-nav";
import { requirePageUser } from "@/server/auth/page-auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageUser({ role: "admin" });
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
