/**
 * Roles older versions gave a state, and the role that replaces each. Only these exact values are
 * changed on existing objects, so a role the user picked by hand stays.
 */
const REPLACED_ROLES: Readonly<Record<string, string>> = {
    // Struck from the official role list. The state counts energy the devices used.
    'value.power.consumption': 'value.energy.consumed',
};

/**
 * @param existing - the object as it is stored, if any
 * @param role - the role the adapter defines for that state now
 * @returns the role to write, or undefined when the object needs no update
 */
export function roleToMigrate(existing: ioBroker.Object | null | undefined, role: string): string | undefined {
    if (existing?.type !== 'state') {
        return undefined;
    }
    const current = existing.common.role;
    return current !== role && Object.hasOwn(REPLACED_ROLES, current) && REPLACED_ROLES[current] === role
        ? role
        : undefined;
}
