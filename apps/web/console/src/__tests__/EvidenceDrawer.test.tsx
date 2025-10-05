import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvidenceDrawer } from "../components/EvidenceDrawer";

function createToken(payload: Record<string, unknown>) {
  const header = { alg: "EdDSA", typ: "JWT" };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.signature-fragment`;
}

describe("EvidenceDrawer", () => {
  it("renders decoded payload and closes", async () => {
    const token = createToken({ rptId: "rpt-42", totals: 12345 });
    const onClose = jest.fn();
    const user = userEvent.setup();

    render(
      <EvidenceDrawer
        isOpen
        onClose={onClose}
        isLoading={false}
        evidence={{ rptId: "rpt-42", evidenceToken: token }}
      />
    );

    expect(screen.getByText(/RPT rpt-42/i)).toBeInTheDocument();
    expect(screen.getByText(/"totals": 12345/)).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
