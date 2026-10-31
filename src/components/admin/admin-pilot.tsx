"use client";

import { useLaundry } from "../laundry/laundry-provider";
import { SummaryBar } from "../laundry/summary-bar";

import { AdminMachineCard } from "./admin-machine-card";

export function AdminPilot() {
  const { state } = useLaundry();
  return (
    <div className="flex flex-col gap-4">
      <SummaryBar />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {state.machines.map((m) => (
          <AdminMachineCard key={m.id} machine={m} />
        ))}
      </div>
    </div>
  );
}
