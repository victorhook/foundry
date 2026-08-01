// The equipment vocabulary shared by the client (chips in the exercise form and
// the active workout) and the server (validating what gets stored).
//
// One exercise = one movement. Which implement you used is picked per session on
// the entry, so "Bench press" stays a single library entry instead of splitting
// into Barbell/Dumbbell/Smith copies. `short` is what fits in a dense summary row.
export type Equipment = { id: string; label: string; short: string };

export const EQUIPMENT: Equipment[] = [
	{ id: 'barbell', label: 'Barbell', short: 'BB' },
	{ id: 'dumbbell', label: 'Dumbbell', short: 'DB' },
	{ id: 'cable', label: 'Cable', short: 'Cable' },
	{ id: 'machine', label: 'Machine', short: 'Mach' },
	{ id: 'smith', label: 'Smith machine', short: 'Smith' },
	{ id: 'kettlebell', label: 'Kettlebell', short: 'KB' },
	{ id: 'band', label: 'Band', short: 'Band' },
	{ id: 'bodyweight', label: 'Bodyweight', short: 'BW' },
	{ id: 'ezbar', label: 'EZ bar', short: 'EZ' },
	{ id: 'trapbar', label: 'Trap bar', short: 'Trap' },
	{ id: 'plate', label: 'Plate', short: 'Plate' }
];

const BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

export function isEquipment(id: unknown): boolean {
	return typeof id === 'string' && BY_ID.has(id);
}

export function equipmentLabel(id: string | null | undefined): string {
	return (id && BY_ID.get(id)?.label) || '';
}

export function equipmentShort(id: string | null | undefined): string {
	return (id && BY_ID.get(id)?.short) || '';
}

/** Keep only known ids, de-duplicated, in the canonical display order. */
export function cleanEquipment(list: unknown): string[] {
	const want = new Set(Array.isArray(list) ? list.map((x) => String(x)) : []);
	return EQUIPMENT.filter((e) => want.has(e.id)).map((e) => e.id);
}
