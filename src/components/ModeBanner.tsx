import React from "react";
import { getComplianceState } from "../utils/compliance";

const helpLinks = {
  prototype: "/help#prototype-readiness",
  rpt: "/help#realtime-payments-testing",
  bas: "/help#bas-label-guidance",
  release: "/help#release-controls",
};

export default function ModeBanner() {
  const { showPrototypeBanner, dspOk } = getComplianceState();

  if (!showPrototypeBanner) {
    return null;
  }

  return (
    <div
      className="mode-banner"
      style={{
        backgroundColor: "#512da8",
        color: "#fff",
        padding: "8px 16px",
        textAlign: "center",
        fontSize: 14,
      }}
    >
      <strong>Prototype:</strong>{" "}
      Accreditation activities with the DSP program are in progress. Review the{" "}
      <a href={helpLinks.prototype} style={{ color: "#ffe082", marginLeft: 4 }}>
        readiness notes
      </a>
      ,{" "}
      <a href={helpLinks.rpt} style={{ color: "#ffe082", marginLeft: 4 }}>
        RPT guidance
      </a>
      ,{" "}
      <a href={helpLinks.bas} style={{ color: "#ffe082", marginLeft: 4 }}>
        BAS label mapping
      </a>
      , and{" "}
      <a href={helpLinks.release} style={{ color: "#ffe082", marginLeft: 4 }}>
        release controls
      </a>{" "}
      before relying on system outputs.
      {!dspOk && (
        <span style={{ display: "block", marginTop: 4 }}>
          Use only with pilot data until DSP approval is confirmed.
        </span>
      )}
    </div>
  );
}
