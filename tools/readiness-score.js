#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const scorecardPath = path.join(__dirname, "..", "ops", "readiness", "scorecard.json");
const rubricPath = path.join(__dirname, "..", "docs", "guardrails", "rubric_v1.0.md");

if (!fs.existsSync(scorecardPath)) {
  console.error("scorecard not found", scorecardPath);
  process.exit(1);
}

const scorecard = JSON.parse(fs.readFileSync(scorecardPath, "utf8"));
const dimensions = scorecard.dimensions || {};
let total = 0;
let weightSum = 0;
for (const value of Object.values(dimensions)) {
  const v = value;
  const weight = typeof v.weight === "number" ? v.weight : 0;
  const score = typeof v.score === "number" ? v.score : 0;
  total += weight * score;
  weightSum += weight;
}
const composite = weightSum > 0 ? total / weightSum : 0;
console.log(JSON.stringify({ composite, weightSum, rubric: rubricPath }, null, 2));
