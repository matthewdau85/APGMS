import React, { useContext, useState } from "react";
import { AppContext } from "../context/AppContext";
import { submitSale } from "../utils/posApi";

interface Sale {
  id: string;
  amount: number;
  exempt: boolean;
}
interface PosIntegrationProps {
  sales: Sale[];
  onAdd: (id: string, amount: number, exempt: boolean) => void;
}

export default function PosIntegration({ sales, onAdd }: PosIntegrationProps) {
  const { adapterModes, logAdapterEvent } = useContext(AppContext);
  const [id, setId] = useState("");
  const [amount, setAmount] = useState(0);
  const [exempt, setExempt] = useState(false);

  async function handleAdd() {
    if (id && amount > 0) {
      try {
        await submitSale({ id, amount, exempt }, { mode: adapterModes.pos, log: logAdapterEvent });
        onAdd(id, amount, exempt);
        setId("");
        setAmount(0);
        setExempt(false);
      } catch (err: any) {
        alert(`POS adapter error: ${err?.message || err}`);
      }
    }
  }

  return (
    <div className="card">
      <h3>Point-of-Sale (POS) Integration</h3>
      <p>
        <b>Add a sale transaction.</b> <br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          This is used for GST calculation. Use “GST Exempt” for transactions that are not subject to GST.
        </span>
      </p>
      <label>
        Sale ID or Reference:
        <input
          type="text"
          placeholder="e.g. INV-12345"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label>
        Sale Amount (including GST):
        <input
          type="number"
          placeholder="e.g. 440"
          value={amount}
          min={0}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5em" }}>
        <input
          type="checkbox"
          checked={exempt}
          onChange={(e) => setExempt(e.target.checked)}
        />
        GST Exempt
      </label>
      <button onClick={handleAdd}>Add Sale</button>
      {sales.length > 0 && (
        <>
          <h4>Sales Transactions</h4>
          <ul>
            {sales.map((s, i) => (
              <li key={i}>
                <b>{s.id}</b>: ${s.amount} {s.exempt ? "(GST Exempt)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
