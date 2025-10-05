import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "../App";

describe("Console experience", () => {
  it("allows operators to toggle the mode pill", async () => {
    const user = userEvent.setup();
    render(<App />);

    const modeSwitch = screen.getByRole("switch", { name: /console mode/i });
    expect(modeSwitch).toHaveAttribute("aria-checked", "true");
    expect(within(modeSwitch).getByTestId("mode-pill-label")).toHaveTextContent("Auto");

    await user.click(modeSwitch);

    expect(modeSwitch).toHaveAttribute("aria-checked", "false");
    expect(within(modeSwitch).getByTestId("mode-pill-label")).toHaveTextContent("Manual");
  });

  it("reveals the kill-switch banner when the switch is enabled", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByTestId("kill-switch-banner")).not.toBeInTheDocument();

    const killSwitchToggle = screen.getByRole("switch", { name: /kill switch/i });
    await user.click(killSwitchToggle);

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/kill switch active/i);

    await user.click(killSwitchToggle);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Issue RPT with a visible reason when the queue is blocked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const gstQueueToggle = screen.getByRole("button", { name: /gst adjustments/i });
    await user.click(gstQueueToggle);

    const issueRptButton = screen.getByRole("button", { name: /issue rpt for gst adjustments/i });
    expect(issueRptButton).toBeDisabled();
    expect(screen.getByRole("note", { name: /awaiting cfo approval/i })).toBeInTheDocument();
  });

  it("expands and collapses queue drawers for contextual detail", async () => {
    const user = userEvent.setup();
    render(<App />);

    const paygwToggle = screen.getByRole("button", { name: /paygw lodgments/i });
    expect(screen.queryByTestId("queue-paygw-drawer")).not.toBeInTheDocument();

    await user.click(paygwToggle);
    const drawer = screen.getByTestId("queue-paygw-drawer");
    expect(drawer).toBeVisible();
    expect(within(drawer).getByText(/ATO settlement window/i)).toBeInTheDocument();

    await user.click(paygwToggle);
    expect(screen.queryByTestId("queue-paygw-drawer")).not.toBeInTheDocument();
  });
});
