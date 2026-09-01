/**
 * Money helpers
 *
 * Every amount in TrackMoney is an integer number of paise. Rupees exist only
 * at the render boundary, which is this file. Nothing else in the codebase is
 * allowed to divide by 100.
 */

/** 49900 -> "₹499" ; 129950 -> "₹1,299.50" */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
}

/** 49900 -> 499 ; used when we need the plain rupee number in text. */
export function paiseToRupeeNumber(paise: number): number {
  return paise / 100;
}
