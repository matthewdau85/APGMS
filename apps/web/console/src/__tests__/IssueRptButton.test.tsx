import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueRptButton } from "../components/IssueRptButton";

describe("IssueRptButton", () => {
  it("shows disabled reason when gates block issuance", async () => {
    render(
      <IssueRptButton
        disabled
        disabledReason="Kill switch is active"
        isSubmitting={false}
        onIssue={() => {}}
      />
    );

    const button = screen.getByRole("button", { name: /issue rpt/i });
    expect(button).toBeDisabled();
    expect(screen.getByTestId("issue-rpt-disabled-reason")).toHaveTextContent("Kill switch is active");
  });

  it("invokes callback when enabled", async () => {
    const user = userEvent.setup();
    const onIssue = jest.fn();
    render(
      <IssueRptButton
        disabled={false}
        isSubmitting={false}
        disabledReason=""
        onIssue={onIssue}
      />
    );

    const button = screen.getByRole("button", { name: /issue rpt/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onIssue).toHaveBeenCalledTimes(1);
  });
});
