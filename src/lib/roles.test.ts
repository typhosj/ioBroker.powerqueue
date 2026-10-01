import { expect } from 'chai';
import { roleToMigrate } from './roles';

function state(role: string | undefined): ioBroker.Object {
    return {
        _id: 'powerqueue.0.stats.plannedTodayWh',
        type: 'state',
        common: { name: 'x', type: 'number', role: role as string, read: true, write: false },
        native: {},
    };
}

describe('roleToMigrate', () => {
    it('moves the struck role value.power.consumption to value.energy.consumed', () => {
        expect(roleToMigrate(state('value.power.consumption'), 'value.energy.consumed')).to.equal(
            'value.energy.consumed',
        );
    });

    it('leaves a role the user picked by hand', () => {
        expect(roleToMigrate(state('value.energy'), 'value.energy.consumed')).to.equal(undefined);
    });

    it('leaves an object that already has the role', () => {
        expect(roleToMigrate(state('value.energy.consumed'), 'value.energy.consumed')).to.equal(undefined);
    });

    it('only migrates to the successor of the old role', () => {
        expect(roleToMigrate(state('value.power.consumption'), 'value.power')).to.equal(undefined);
    });

    it('ignores missing objects, other object types and odd roles', () => {
        expect(roleToMigrate(null, 'value.energy.consumed')).to.equal(undefined);
        expect(roleToMigrate(undefined, 'value.energy.consumed')).to.equal(undefined);
        expect(
            roleToMigrate({ _id: 'x', type: 'channel', common: { name: 'x' }, native: {} }, 'value.energy.consumed'),
        ).to.equal(undefined);
        expect(roleToMigrate(state(undefined), 'value.energy.consumed')).to.equal(undefined);
        expect(roleToMigrate(state('toString'), 'value.energy.consumed')).to.equal(undefined);
        expect(roleToMigrate(state('constructor'), 'value.energy.consumed')).to.equal(undefined);
    });
});
