import React, { useState } from "react";
import { EmptyState } from "../ui/states";

interface PayrollIntegrationProps {
  payroll: { employee: string; gross: number; withheld: number }[];
  onAdd: (employee: string, gross: number, withheld: number) => void;
}

export default function PayrollIntegration({ payroll, onAdd }: PayrollIntegrationProps) {
  const [employee, setEmployee] = useState("");
  const [gross, setGross] = useState(0);
  const [withheld, setWithheld] = useState(0);

  function handleAdd() {
    if (employee && gross > 0) {
      onAdd(employee, gross, withheld);
      setEmployee("");
      setGross(0);
      setWithheld(0);
    }
  }

  return (
    <div className="card">
      <h3>Payroll Integration</h3>
      <p>
        <b>Add a payroll entry for an employee.</b> <br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          This is used for PAYGW calculations. Enter each employee’s details below.
        </span>
      </p>
      <label>
        Employee Name:
        <input
          type="text"
          placeholder="e.g. John Smith"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        />
      </label>
      <label>
        Gross Income (before tax):
        <input
          type="number"
          placeholder="e.g. 1500"
          value={gross}
          min={0}
          onChange={(e) => setGross(Number(e.target.value))}
        />
      </label>
      <label>
        Tax Withheld (PAYGW):
        <input
          type="number"
          placeholder="e.g. 200"
          value={withheld}
          min={0}
          onChange={(e) => setWithheld(Number(e.target.value))}
        />
      </label>
      <button onClick={handleAdd}>Add Payroll Entry</button>
      {payroll.length > 0 ? (
        <>
          <h4>Payroll Entries</h4>
          <ul>
            {payroll.map((p, i) => (
              <li key={i}>
                <b>{p.employee}</b>: Gross ${p.gross} | Withheld ${p.withheld}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          title="No payroll entries yet"
          body="Sync your payroll provider or add the first employee so PAYGW calculations can begin."
          ctaLabel="Import from payroll"
          onCta={() => {
            alert("Connect a payroll provider to import recent pay runs.");
          }}
        />
      )}
    </div>
  );
}
