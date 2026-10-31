"use client";

import { MachineCard } from "./machine-card";
import { MyReservation } from "./my-reservation";
import { SummaryBar } from "./summary-bar";
import { useLaundry } from "./laundry-provider";

export function Dashboard() {
  const { state } = useLaundry();
  return (
    <div className="flex flex-col gap-4">
      <SummaryBar />
      {state.viewer.role === "student" && <MyReservation compact />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {state.machines.map((m) => (
          <MachineCard key={m.id} machine={m} />
        ))}
      </div>
    </div>
  );
}
