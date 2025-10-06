import React from "react";
import PaygiPlanner from "../components/PaygiPlanner";

export default function PAYGI() {
  return (
    <div className="main-card space-y-6">
      <div>
        <h1 className="text-3xl font-bold">PAYG Instalments (PAYGI)</h1>
        <p className="text-sm text-gray-600">
          Manage PAYGI instalments, record notices, and capture evidence that supports safe-harbour compliance.
        </p>
      </div>
      <PaygiPlanner />
    </div>
  );
}
