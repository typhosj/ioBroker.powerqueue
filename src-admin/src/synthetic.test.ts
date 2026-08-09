/**
 * The example household is what a new user sees first, so it has to behave the way the text
 * promises: the pump runs on the photovoltaic surplus, and it does not chatter.
 */

import { expect } from 'chai';
import { exampleHousehold, runtimeByConsumer, simulateDay, switchEvents } from './synthetic';

const DAY_START = new Date(2026, 7, 9).getTime(); // local midnight, so the hours match the curve

describe('example household', () => {
    const steps = simulateDay(exampleHousehold(), DAY_START);
    const events = switchEvents(steps);

    it('covers the whole day in five minute steps', () => {
        expect(steps).to.have.length(288);
    });

    it('runs the pump on the surplus around midday and nothing at night', () => {
        const running = (hour: number): boolean => steps[hour * 12].plan.consumers[0].proposedPowerW > 0;
        expect(running(3)).to.equal(false);
        expect(running(12)).to.equal(true);
        expect(running(23)).to.equal(false);
    });

    it('does not chatter: the pump switches a handful of times, not every step', () => {
        expect(events.length).to.be.greaterThan(0);
        expect(events.length).to.be.lessThan(10);
    });

    it('respects the minimum on and off times it is configured with', () => {
        const consumer = exampleHousehold().consumers[0];
        for (let i = 1; i < events.length; i++) {
            const gap = events[i].ts - events[i - 1].ts;
            const required = events[i].on ? consumer.minOffMinutes : consumer.minOnMinutes;
            expect(gap).to.be.at.least(required * 60_000);
        }
    });

    it('accounts for a plausible amount of runtime', () => {
        // A summer photovoltaic day carries the pump from mid-morning until the evening cooking peak.
        const seconds = runtimeByConsumer(steps)['example-pump'];
        expect(seconds).to.be.greaterThan(3 * 3600);
        expect(seconds).to.be.at.most(12 * 3600);
    });

    it('adds the running pump to the grid reading, so the surplus is really used up', () => {
        const midday = steps[12 * 12];
        expect(midday.gridW - midday.baseGridW).to.equal(1000);
    });
});
