const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbn(abn: string): boolean {
  const digits = abn.replace(/\s+/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const numbers = digits.split("").map(n => Number(n));
  numbers[0] = numbers[0] - 1;
  const sum = numbers.reduce((acc, digit, idx) => acc + digit * ABN_WEIGHTS[idx], 0);
  return sum % 89 === 0;
}

export function isValidBsb(bsb: string): boolean {
  const cleaned = bsb.replace(/[^0-9]/g, "");
  return /^\d{6}$/.test(cleaned);
}

export function isValidCrn(crn: string): boolean {
  const cleaned = crn.replace(/\s+/g, "");
  return /^\d{6,20}$/.test(cleaned);
}
