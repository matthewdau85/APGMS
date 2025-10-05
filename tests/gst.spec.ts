import assert from "node:assert/strict";
import { aggregateBas, calculateGst, classifyGstEvent } from "../src/utils/gst";
import { GstEvent, ReportingPeriod } from "../src/types/tax";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "calculates GST for taxable and exempt supplies",
    run: () => {
      assert.equal(calculateGst({ saleAmount: 110, classification: "taxable" }), 10);
      assert.equal(calculateGst({ saleAmount: 110, classification: "gst_free" }), 0);
      assert.equal(calculateGst({ saleAmount: 110, exempt: true }), 0);
    },
  },
  {
    name: "aggregates mixed supplies on accrual basis",
    run: () => {
      const period: ReportingPeriod = {
        start: "2024-01-01",
        end: "2024-03-31",
        basis: "accrual",
      };

      const events: GstEvent[] = [
        {
          kind: "sale",
          id: "S-001",
          issueDate: "2024-02-15",
          components: [
            { category: "taxable", amount: 1100 },
            { category: "gst_free", amount: 550 },
          ],
        },
        {
          kind: "sale",
          id: "S-002",
          issueDate: "2024-03-10",
          components: [{ category: "export", amount: 2200 }],
        },
        {
          kind: "purchase",
          id: "P-001",
          issueDate: "2024-02-20",
          claimable: true,
          components: [
            { category: "taxable", amount: 770, capital: true },
            { category: "taxable", amount: 330, capital: false },
            { category: "gst_free", amount: 110, capital: false },
          ],
        },
      ];

      const summary = aggregateBas(events, period);

      assert.equal(summary.labels.G1, 3850);
      assert.equal(summary.labels.G2, 2200);
      assert.equal(summary.labels.G3, 550);
      assert.equal(summary.labels.G4, 0);
      assert.equal(summary.labels.G5, 1100);
      assert.equal(summary.labels.G6, 1100);
      assert.equal(summary.labels.G10, 770);
      assert.equal(summary.labels.G11, 440);
      assert.equal(summary.labels.G12, 1210);
      assert.equal(summary.labels.G14, 110);
      assert.equal(summary.gstCollected, 100);
      assert.equal(summary.gstCredits, 100);
      assert.equal(summary.netAmount, 0);

      assert.equal(classifyGstEvent(events[0]), "mixed");
      assert.equal(classifyGstEvent(events[1]), "gst_free");
    },
  },
  {
    name: "respects cash basis for timing of supplies",
    run: () => {
      const period: ReportingPeriod = {
        start: "2024-01-01",
        end: "2024-03-31",
        basis: "cash",
      };

      const events: GstEvent[] = [
        {
          kind: "sale",
          id: "S-100",
          issueDate: "2024-02-01",
          paymentDate: "2024-04-05",
          components: [{ category: "taxable", amount: 550 }],
        },
        {
          kind: "sale",
          id: "S-101",
          issueDate: "2024-01-15",
          paymentDate: "2024-03-20",
          components: [{ category: "taxable", amount: 330 }],
        },
        {
          kind: "purchase",
          id: "P-200",
          issueDate: "2024-01-10",
          paymentDate: "2024-03-25",
          claimable: true,
          components: [{ category: "taxable", amount: 220, capital: false }],
        },
        {
          kind: "purchase",
          id: "P-201",
          issueDate: "2024-02-10",
          paymentDate: "2024-04-02",
          claimable: true,
          components: [{ category: "taxable", amount: 440, capital: true }],
        },
      ];

      const summary = aggregateBas(events, period);

      assert.equal(summary.labels.G1, 330);
      assert.equal(summary.labels.G5, 330);
      assert.equal(summary.labels.G11, 220);
      assert.equal(summary.labels.G12, 220);
      assert.equal(summary.gstCollected, 30);
      assert.equal(summary.gstCredits, 20);
      assert.equal(summary.netAmount, 10);
    },
  },
  {
    name: "applies adjustments, purchase credits and imports",
    run: () => {
      const period: ReportingPeriod = {
        start: "2024-04-01",
        end: "2024-06-30",
        basis: "accrual",
      };

      const events: GstEvent[] = [
        {
          kind: "sale",
          id: "S-300",
          issueDate: "2024-04-15",
          components: [{ category: "taxable", amount: 1210 }],
        },
        {
          kind: "purchase",
          id: "P-300",
          issueDate: "2024-05-01",
          claimable: true,
          components: [
            { category: "taxable", amount: 550, capital: false, importation: true, gstAmount: 50 },
          ],
          purchaseCredits: [
            { reference: "CR-1", creditDate: "2024-05-15", amount: 55, gstAmount: 5 },
          ],
        },
        {
          kind: "adjustment",
          note: {
            reference: "ADJ-1",
            date: "2024-05-30",
            amount: 132,
            gstAmount: 12,
            direction: "decreasing",
            target: "sales",
          },
        },
        {
          kind: "adjustment",
          note: {
            reference: "ADJ-2",
            date: "2024-06-15",
            amount: 66,
            gstAmount: 6,
            direction: "increasing",
            target: "purchases",
          },
        },
        {
          kind: "adjustment",
          note: {
            reference: "ADJ-3",
            date: "2024-06-20",
            amount: 33,
            gstAmount: 3,
            direction: "decreasing",
            target: "purchases",
          },
        },
      ];

      const summary = aggregateBas(events, period);

      assert.equal(summary.labels.G1, 1210);
      assert.equal(summary.labels.G5, 1210);
      assert.equal(summary.labels.G7, 253);
      assert.equal(summary.labels.G8, 33);
      assert.equal(summary.labels.G9, 220);
      assert.equal(summary.labels.G11, 550);
      assert.equal(summary.labels.G12, 550);
      assert.equal(summary.gstCollected, 98);
      assert.equal(summary.gstCredits, 58);
      assert.equal(summary.netAmount, 40);
    },
  },
];

for (const test of tests) {
  try {
    test.run();
    console.log(`✔ ${test.name}`);
  } catch (error) {
    console.error(`✘ ${test.name}`);
    throw error;
  }
}

console.log("All GST module tests passed.");
