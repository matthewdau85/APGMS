describe("Operator console queues", () => {
  beforeEach(() => {
    cy.visit("/?overrides=true");
  });

  it("shows the three primary queues", () => {
    cy.contains('button', 'Pending Anomalies').should('exist');
    cy.contains('button', 'Unreconciled Bank Lines').should('exist');
    cy.contains('button', 'Stuck Transitions').should('exist');
  });

  it("drills into an item and displays RPT details", () => {
    cy.contains('button', 'Unreconciled Bank Lines').click();
    cy.contains('button', 'Missing credit for payout batch 8821').click();
    cy.contains('h3', 'Missing credit for payout batch 8821').should('exist');
    cy.contains('h4', 'Decoded JWS').should('exist');
    cy.contains('Evidence ID: evt-990').should('exist');
  });

  it("requires reason and approver when overrides enabled", () => {
    cy.contains('button', 'Pending Anomalies').click();
    cy.contains('button', 'Manual override scheduled for partner AUS-COMM').click();
    cy.get('textarea[name="action-reason"]').type('Documenting override for reconciliation.');
    cy.get('input[name="action-approver"]').type('J. Patel');
    cy.contains('button', 'Log action').should('not.be.disabled');
  });
});
