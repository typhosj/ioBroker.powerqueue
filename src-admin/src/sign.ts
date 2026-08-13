/**
 * The sign convention of a signed reading, as the user confirms it.
 *
 * PowerQueue never asks "is import positive?" — it shows two complete sentences containing the
 * current reading and stores what the confirmed sentence implies. Both directions of that
 * translation are the same question, which is why one function answers both:
 *
 * - which convention a confirmed sentence implies, and
 * - which sentence a stored convention selects for the reading shown right now.
 *
 * Keeping it here, free of React, is deliberate: getting it backwards inverts a household's grid
 * meter, and the mistake is invisible while the reading happens to be positive.
 */

/**
 * @param firstSentence - `true` for the first sentence: power drawn from the grid, battery charging
 * @param readingIsPositive - whether the raw reading shown with the sentences is positive
 * @returns whether a positive reading means the first sentence
 */
export function positiveMeansFirst(firstSentence: boolean, readingIsPositive: boolean): boolean {
    return firstSentence === readingIsPositive;
}
