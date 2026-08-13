import { expect } from 'chai';
import { positiveMeansFirst } from './sign';

describe('positiveMeansFirst', () => {
    it('reads a positive meter the obvious way', () => {
        // "2331 W are drawn from the grid" while the meter shows +2331: import is positive.
        expect(positiveMeansFirst(true, true)).to.equal(true);
        // "2331 W are fed into the grid" while the meter shows +2331: import is negative.
        expect(positiveMeansFirst(false, true)).to.equal(false);
    });

    it('reads a negative meter the other way round', () => {
        // The reading is shown as an amount, so the same sentences appear for -2331.
        expect(positiveMeansFirst(true, false)).to.equal(false);
        expect(positiveMeansFirst(false, false)).to.equal(true);
    });

    it('selects back the sentence the user confirmed', () => {
        // The round trip is what the dialog depends on: whatever is confirmed has to come back as
        // the selected sentence, for a positive as well as for a negative reading.
        for (const readingIsPositive of [true, false]) {
            for (const confirmed of [true, false]) {
                const stored = positiveMeansFirst(confirmed, readingIsPositive);
                expect(positiveMeansFirst(stored, readingIsPositive)).to.equal(confirmed);
            }
        }
    });
});
