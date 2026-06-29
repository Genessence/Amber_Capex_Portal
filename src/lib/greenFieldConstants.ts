import type { CapexMasterItem, FieldType, GreenFieldBudgetAllocations, ProjectType } from './types';

export const PROJECT_TYPES = ['rac', 'ems', 'component', 'fan'] as const;
/** @deprecated Use PROJECT_TYPES */
export const GREEN_FIELD_PROJECT_TYPES = PROJECT_TYPES;

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  rac: 'RAC',
  ems: 'EMS',
  component: 'Component',
  fan: 'Fan',
};
/** @deprecated Use PROJECT_TYPE_LABELS */
export const GREEN_FIELD_PROJECT_TYPE_LABELS = PROJECT_TYPE_LABELS;

export const DEFAULT_PROJECT_TYPE: ProjectType = 'rac';
/** @deprecated Use DEFAULT_PROJECT_TYPE */
export const DEFAULT_GREEN_FIELD_PROJECT_TYPE = DEFAULT_PROJECT_TYPE;

export const DIGITISATION_MIGRATION_V1 = 'digitisation_v1';
export const FLAT_MASTER_MIGRATION_V1 = 'flat_master_v1';
export const GREEN_FIELD_SECTION_MIGRATION_V1 = 'green_field_sections_v1';
export const BROWN_FIELD_NESTED_MIGRATION_V1 = 'brown_field_nested_v1';

/** Internal storage bucket — not shown in master UI. */
export const FLAT_MASTER_DIVISION = 'Other Brown Field' as const;

export function normalizeProjectType(
  value: ProjectType | undefined | null,
): ProjectType {
  return value ?? DEFAULT_PROJECT_TYPE;
}

/** @deprecated Use normalizeProjectType */
export function normalizeGreenFieldProjectType(
  value: ProjectType | undefined | null,
): ProjectType {
  return normalizeProjectType(value);
}

/** Resolve projectType from item, falling back to legacy greenFieldProjectType. */
export function resolveProjectType(item: {
  projectType?: ProjectType | null;
  greenFieldProjectType?: ProjectType | null;
}): ProjectType {
  return normalizeProjectType(item.projectType ?? item.greenFieldProjectType);
}

export function withProjectType<T extends { projectType?: ProjectType; greenFieldProjectType?: ProjectType }>(
  item: T,
): T & { projectType: ProjectType } {
  const projectType = resolveProjectType(item);
  return { ...item, projectType, greenFieldProjectType: projectType };
}

/** Legacy flat Brown Field heads (non-division Machinery/Utilities). */
export const BROWN_FIELD_HEAD_ORDER = [
  'Automation',
  'Machinery',
  'General',
  'Digitization',
  'New Business',
  'Safety & Security',
  'Utilities',
  'Misc.',
];

/** Green Field master sections (post site-creation). */
export const GREEN_FIELD_SECTION_ORDER = [
  'Plant Machinery',
  'Utilities',
  'Compliances',
  'Information Technology',
] as const;

export type GreenFieldSection = (typeof GREEN_FIELD_SECTION_ORDER)[number];

export const GREEN_FIELD_SECTION_HEADS: Record<GreenFieldSection, readonly string[]> = {
  'Plant Machinery': [
    'Moulding Shop',
    'Press Shop',
    'Copper Shop',
    'Paint Shop',
    'Tool Room',
    'Assembly Shop',
    'Lab & Quality Shop',
    'Research and Development',
  ],
  Utilities: [
    'Fire & Safety',
    'N2/O2/Helium/LPG/PNG',
    'ETP/STP',
    'Electrical',
    'Misc.',
  ],
  Compliances: [],
  'Information Technology': [],
};

export const GREEN_FIELD_HEAD_ORDER = GREEN_FIELD_SECTION_ORDER.flatMap(
  section => [...GREEN_FIELD_SECTION_HEADS[section], section],
);

/** @deprecated Legacy Green Field division names — used only for migration. */
export const GF_DIVISION_ORDER = ['Land & Building', 'Machinery', 'Utilities', 'Legal'] as const;

export type GFDivision = (typeof GF_DIVISION_ORDER)[number];

/** @deprecated Legacy Green Field division heads — used only for migration. */
export const GF_DIVISION_HEADS: Record<GFDivision, string[]> = {
  'Land & Building': [
    'Land Buying',
    'Land Infrastructure',
    'Admin Blocks',
    'Furniture',
    'Compliances',
    'Misc.',
  ],
  Machinery: [
    'Moulding Shop',
    'Paint Shop',
    'Press Shop',
    'Copper Shop',
    'Assembly Shop',
    'IT Shop',
    'Automation Shop',
    'Tool Room Shop',
    'Lab & Quality Shop',
    'Storage Shop',
    'Misc. Shop',
  ],
  Utilities: [
    'Fire & Safety',
    'N2/O2/Helium/LPG/PNG',
    'ETP/STP',
    'Electrical',
    'Misc.',
  ],
  Legal: [],
};

/** Brown Field division tabs — includes internal bucket for legacy heads. */
export const BROWN_FIELD_DIVISION_ORDER = [
  'Machinery',
  'Utilities',
  'Legal',
  'Other Brown Field',
] as const;

/** Divisions shown in Brown Field new-request picker (excludes internal bucket). */
export const BROWN_FIELD_REQUEST_DIVISION_ORDER = ['Machinery', 'Utilities', 'Legal'] as const;

export type BrownFieldDivision = (typeof BROWN_FIELD_DIVISION_ORDER)[number];
export type BrownFieldRequestDivision = (typeof BROWN_FIELD_REQUEST_DIVISION_ORDER)[number];
export type FieldDivision =
  | GreenFieldSection
  | BrownFieldDivision
  | DigitisationDivision
  | ITDivision
  | GFDivision;

export const BROWN_FIELD_OTHER_HEADS = BROWN_FIELD_HEAD_ORDER.filter(
  h => h !== 'Machinery' && h !== 'Utilities' && h !== 'Digitization',
);

/** Digitisation master — migrated from Brown Field Digitization head. */
export const DIGITISATION_HEAD_ORDER = [
  'Digitization',
  'Automation',
  'Software & Licenses',
  'Infrastructure',
  'Misc.',
] as const;

/** Information Technology master — admin-defined placeholder heads. */
export const IT_HEAD_ORDER = [
  'Hardware',
  'Software & Licenses',
  'Network & Security',
  'Cloud Services',
  'Support & AMC',
  'Misc.',
] as const;

export const DIGITISATION_DIVISION_ORDER = ['Digitisation'] as const;
export const IT_DIVISION_ORDER = ['Information Technology'] as const;

export type DigitisationDivision = (typeof DIGITISATION_DIVISION_ORDER)[number];
export type ITDivision = (typeof IT_DIVISION_ORDER)[number];

export const BROWN_FIELD_DIVISION_HEADS: Record<BrownFieldDivision, string[]> = {
  Machinery: GF_DIVISION_HEADS.Machinery,
  Utilities: GF_DIVISION_HEADS.Utilities,
  Legal: [],
  'Other Brown Field': BROWN_FIELD_OTHER_HEADS,
};

/** Flat ordered list of all Green Field sub-heads across divisions. */
export const GF_ALL_HEAD_ORDER = GF_DIVISION_ORDER.flatMap(d => GF_DIVISION_HEADS[d]);

export const DIGITISATION_DIVISION_HEADS: Record<DigitisationDivision, string[]> = {
  Digitisation: [...DIGITISATION_HEAD_ORDER],
};

export const IT_DIVISION_HEADS: Record<ITDivision, string[]> = {
  'Information Technology': [...IT_HEAD_ORDER],
};

export interface MasterItemFilter {
  capexMaster: CapexMasterItem[];
  plant: string;
  fieldType: FieldType;
  fy: string;
  projectType?: ProjectType | null;
  /** @deprecated Use projectType */
  greenFieldProjectType?: ProjectType | null;
  division?: FieldDivision | null;
  head?: string | null;
}

export function getLatestMasterFy(capexMaster: CapexMasterItem[]): string {
  const fys = [...new Set(capexMaster.map(m => m.fy))].sort((a, b) => b.localeCompare(a));
  return fys[0] ?? '2025-26';
}

/**
 * Latest FY among master items of a single field type. Used so that publishing a
 * future Brown Field FY does not change the active FY for Green Field / Digitisation / IT.
 * Falls back to the global latest FY when the field type has no rows yet.
 */
export function getLatestMasterFyForField(
  capexMaster: CapexMasterItem[],
  fieldType: FieldType,
): string {
  const scoped = capexMaster.filter(m => (m.fieldType ?? 'brown_field') === fieldType);
  if (!scoped.length) return getLatestMasterFy(capexMaster);
  return getLatestMasterFy(scoped);
}

export function filterMasterItemsForRequest(opts: MasterItemFilter): CapexMasterItem[] {
  const projectType = opts.projectType ?? opts.greenFieldProjectType;
  return opts.capexMaster.filter(m => {
    if (m.plant !== opts.plant) return false;
    if (m.fy !== opts.fy) return false;
    if ((m.fieldType ?? 'brown_field') !== opts.fieldType) return false;
    if (
      (opts.fieldType === 'green_field' || opts.fieldType === 'brown_field') &&
      projectType
    ) {
      if (resolveProjectType(m) !== projectType) return false;
    }
    if (opts.division && m.division !== opts.division) return false;
    if (opts.head && m.head !== opts.head) return false;
    return true;
  });
}

export function getFieldDivisionOrder(fieldType: FieldType): readonly FieldDivision[] {
  if (fieldType === 'green_field') return GREEN_FIELD_SECTION_ORDER;
  if (fieldType === 'digitisation') return DIGITISATION_DIVISION_ORDER;
  if (fieldType === 'information_technology') return IT_DIVISION_ORDER;
  return BROWN_FIELD_DIVISION_ORDER;
}

export function isGreenFieldSection(value: string): value is GreenFieldSection {
  return (GREEN_FIELD_SECTION_ORDER as readonly string[]).includes(value);
}

export function isBrownFieldDivision(value: string): value is BrownFieldDivision {
  return (BROWN_FIELD_DIVISION_ORDER as readonly string[]).includes(value);
}

export function brownFieldDivisionHasPredefinedHeads(division: BrownFieldDivision): boolean {
  return BROWN_FIELD_DIVISION_HEADS[division].length > 0;
}

export function defaultHeadForBrownFieldDivision(division: BrownFieldDivision): string {
  const heads = BROWN_FIELD_DIVISION_HEADS[division];
  return heads[0] ?? division;
}

export function greenFieldSectionHasPredefinedHeads(section: GreenFieldSection): boolean {
  return GREEN_FIELD_SECTION_HEADS[section].length > 0;
}

export function defaultHeadForGreenFieldSection(section: GreenFieldSection): string {
  const heads = GREEN_FIELD_SECTION_HEADS[section];
  return heads[0] ?? section;
}

export function getFieldDivisionHeads(
  fieldType: FieldType,
  division: FieldDivision,
): string[] {
  if (fieldType === 'green_field' && isGreenFieldSection(division)) {
    const heads = [...GREEN_FIELD_SECTION_HEADS[division]];
    if (!heads.length) return [division];
    return heads;
  }
  if (fieldType === 'green_field') {
    return [];
  }
  if (fieldType === 'digitisation') {
    return DIGITISATION_DIVISION_HEADS[division as DigitisationDivision] ?? [];
  }
  if (fieldType === 'information_technology') {
    return IT_DIVISION_HEADS[division as ITDivision] ?? [];
  }
  return BROWN_FIELD_DIVISION_HEADS[division as BrownFieldDivision] ?? [];
}

export function defaultDivisionForFieldType(fieldType: FieldType): FieldDivision {
  if (fieldType === 'green_field') return 'Plant Machinery';
  if (fieldType === 'brown_field') return FLAT_MASTER_DIVISION;
  if (fieldType === 'digitisation') return 'Digitisation';
  if (fieldType === 'information_technology') return 'Information Technology';
  return FLAT_MASTER_DIVISION;
}

export function isFlatMasterFieldType(fieldType: FieldType): boolean {
  return fieldType === 'brown_field';
}

export function getCanonicalHeadOrder(fieldType: FieldType): readonly string[] {
  if (fieldType === 'green_field') return GREEN_FIELD_HEAD_ORDER;
  if (fieldType === 'digitisation') return DIGITISATION_HEAD_ORDER;
  if (fieldType === 'information_technology') return IT_HEAD_ORDER;
  return BROWN_FIELD_HEAD_ORDER;
}

/** Normalize Brown Field master rows to a single flat division bucket. */
export function migrateToFlatMaster(items: CapexMasterItem[]): CapexMasterItem[] {
  return items.map(item => {
    const fieldType = item.fieldType ?? 'brown_field';
    if (fieldType !== 'brown_field') return item;
    return { ...item, division: FLAT_MASTER_DIVISION };
  });
}

const LEGACY_GREEN_FIELD_HEAD_ALIASES: Record<string, string> = {
  'Tool Room Shop': 'Tool Room',
  'Misc. Shop': 'Misc.',
};

const LEGACY_PLANT_MACHINERY_HEADS = new Set([
  ...GREEN_FIELD_SECTION_HEADS['Plant Machinery'],
  'Tool Room Shop',
  'Automation Shop',
  'IT Shop',
  'Storage Shop',
  'Misc. Shop',
  'Automation',
  'Machinery',
  'General',
  'New Business',
  'Moulding Shop',
  'Paint Shop',
  'Press Shop',
  'Copper Shop',
  'Assembly Shop',
  'Lab & Quality Shop',
]);

const LEGACY_UTILITIES_HEADS = new Set([
  ...GREEN_FIELD_SECTION_HEADS.Utilities,
  'Utilities',
  'Safety & Security',
]);

function normalizeGreenFieldHead(head: string): string {
  return LEGACY_GREEN_FIELD_HEAD_ALIASES[head] ?? head;
}

function inferGreenFieldSection(item: CapexMasterItem): GreenFieldSection {
  const head = normalizeGreenFieldHead(item.head);
  const division = item.division ?? '';

  if (isGreenFieldSection(division)) return division;

  if (GREEN_FIELD_SECTION_HEADS['Plant Machinery'].includes(head)) return 'Plant Machinery';
  if (LEGACY_PLANT_MACHINERY_HEADS.has(head)) return 'Plant Machinery';
  if (GREEN_FIELD_SECTION_HEADS.Utilities.includes(head)) return 'Utilities';
  if (LEGACY_UTILITIES_HEADS.has(head)) return 'Utilities';

  if (head === 'Compliances' || head === 'Compliance') return 'Compliances';
  if (
    head === 'Information Technology' ||
    head === 'IT' ||
    division === 'Information Technology'
  ) {
    return 'Information Technology';
  }

  if (division === 'Machinery' || division === 'Land & Building') return 'Plant Machinery';
  if (division === 'Utilities') return 'Utilities';
  if (division === 'Legal' || division === 'Other Brown Field') return 'Compliances';

  if (head === 'Digitization' || head === 'Misc.') return 'Compliances';

  return 'Compliances';
}

function normalizeGreenFieldHeadForSection(
  item: CapexMasterItem,
  section: GreenFieldSection,
): string {
  const head = normalizeGreenFieldHead(item.head);
  const predefined = GREEN_FIELD_SECTION_HEADS[section];

  if (predefined.includes(head)) return head;
  if (!predefined.length) return head || section;

  if (section === 'Plant Machinery') {
    if (head === 'Machinery' || head === 'Automation') return 'Assembly Shop';
    if (head === 'General' || head === 'New Business') return 'Research and Development';
    if (LEGACY_PLANT_MACHINERY_HEADS.has(head)) {
      if (head === 'Tool Room Shop') return 'Tool Room';
      return predefined[0];
    }
  }

  if (section === 'Utilities') {
    if (head === 'Utilities' || head === 'Safety & Security') return 'Electrical';
    if (LEGACY_UTILITIES_HEADS.has(head)) return head === 'Utilities' ? 'Electrical' : head;
  }

  return head || defaultHeadForGreenFieldSection(section);
}

/** Migrate Green Field rows to section + child-head structure. */
export function migrateGreenFieldToSections(items: CapexMasterItem[]): CapexMasterItem[] {
  return items.map(item => {
    if ((item.fieldType ?? 'brown_field') !== 'green_field') return item;
    const withType = withProjectType(item);
    const section = inferGreenFieldSection(withType);
    const head = normalizeGreenFieldHeadForSection(withType, section);
    return { ...withType, division: section, head };
  });
}

export function isProjectTypeScopedField(fieldType: FieldType): boolean {
  return fieldType === 'green_field' || fieldType === 'brown_field';
}

/** Unique heads present in items, ordered by canonical list then extras alphabetically. */
export function getOrderedHeadsForScope(
  items: CapexMasterItem[],
  fieldType: FieldType,
  division?: FieldDivision | null,
): string[] {
  const present = new Set(items.map(m => m.head).filter(Boolean));
  const canonical =
    division != null && !isFlatMasterFieldType(fieldType)
      ? getFieldDivisionHeads(fieldType, division)
      : getCanonicalHeadOrder(fieldType);
  const ordered = canonical.filter(h => present.has(h));
  const extras = [...present].filter(h => !canonical.includes(h)).sort();
  return [...ordered, ...extras];
}

export function isMachineryDivision(division: FieldDivision | null | undefined): boolean {
  return division === 'Machinery';
}

export function isLegalDivisionEmpty(fieldType: FieldType, division: FieldDivision): boolean {
  return division === 'Legal' && getFieldDivisionHeads(fieldType, division).length === 0;
}

const LAND_BUILDING_HEADS = new Set(GF_DIVISION_HEADS['Land & Building']);
const MACHINERY_HEADS = new Set(GF_DIVISION_HEADS.Machinery);
const UTILITIES_HEADS = new Set(GF_DIVISION_HEADS.Utilities);

export function getDivisionForHead(head: string): GFDivision | undefined {
  if (LAND_BUILDING_HEADS.has(head)) return 'Land & Building';
  if (MACHINERY_HEADS.has(head)) return 'Machinery';
  if (UTILITIES_HEADS.has(head)) return 'Utilities';
  return undefined;
}

function mapMachineryDepartment(department: string, subParticulars: string): string {
  const dept = department.toLowerCase();
  const sub = subParticulars.toLowerCase();

  if (dept.includes('plastic') || dept.includes('foam') || sub.includes('mould')) return 'Moulding Shop';
  if (sub.includes('paint')) return 'Paint Shop';
  if (dept.includes('sheet metal')) {
    if (sub.includes('press') && !sub.includes('punch')) return 'Press Shop';
    return 'Copper Shop';
  }
  if (dept.includes('heat exchanger')) return 'Assembly Shop';
  if (dept.includes('assembly')) return 'Assembly Shop';
  if (dept.includes('quality')) return 'Lab & Quality Shop';
  if (sub.includes('automation') || sub.includes('agv') || sub.includes('plc') || sub.includes('scada')) {
    return 'Automation Shop';
  }
  if (sub.includes('tool room') || sub.includes('drill press') || sub.includes('lathe')) return 'Tool Room Shop';
  if (
    sub.includes('forklift') ||
    sub.includes('pallet') ||
    sub.includes('weighbridge') ||
    sub.includes('trolley') ||
    sub.includes('crane') ||
    sub.includes('storage')
  ) {
    return 'Storage Shop';
  }
  if (
    sub.includes('server') ||
    sub.includes('erp') ||
    sub.includes('network') ||
    sub.includes('cnc') ||
    sub.includes('it ')
  ) {
    return 'IT Shop';
  }
  return 'Assembly Shop';
}

function mapUtilitiesDepartment(
  department: string,
  subParticulars: string,
): { division: GFDivision; head: string } {
  const dept = department.toLowerCase();
  const sub = subParticulars.toLowerCase();

  if (dept.includes('it & infrastructure') || dept.includes('it infrastructure')) {
    return { division: 'Machinery', head: 'IT' };
  }
  if (dept.includes('fire')) return { division: 'Utilities', head: 'Fire & Safety' };
  if (
    dept.includes('ehs') ||
    sub.includes('etp') ||
    sub.includes('stp') ||
    sub.includes('effluent') ||
    sub.includes('sewage')
  ) {
    return { division: 'Utilities', head: 'ETP/STP' };
  }
  if (
    dept.includes('hvac') ||
    sub.includes('compressor') ||
    sub.includes('n2') ||
    sub.includes('o2') ||
    sub.includes('lpg') ||
    sub.includes('png') ||
    sub.includes('helium') ||
    sub.includes('chiller') ||
    sub.includes('cooling tower')
  ) {
    return { division: 'Utilities', head: 'N2/O2/Helium/LPG/PNG' };
  }
  if (dept.includes('electrical')) return { division: 'Utilities', head: 'Electrical' };
  return { division: 'Utilities', head: 'Electrical' };
}

function mapMiscItem(subParticulars: string): { division: GFDivision; head: string } {
  const sub = subParticulars.toLowerCase();
  if (sub.includes('tool room')) return { division: 'Machinery', head: 'Tool Room Shop' };
  if (
    sub.includes('forklift') ||
    sub.includes('pallet') ||
    sub.includes('weighbridge') ||
    sub.includes('trolley')
  ) {
    return { division: 'Machinery', head: 'Storage Shop' };
  }
  return { division: 'Land & Building', head: 'Misc.' };
}

const DIVISION_NAMES = new Set<string>(GF_DIVISION_ORDER);

function isStaleGreenFieldHead(head: string): boolean {
  return DIVISION_NAMES.has(head) || head === 'Machinery' || head === 'Utilities';
}

function withGreenFieldProjectType(item: CapexMasterItem): CapexMasterItem {
  return withProjectType(item);
}

/** Migrate legacy Green Field master rows to division + sub-head structure. */
export function migrateGreenFieldMasterItem(item: CapexMasterItem): CapexMasterItem {
  if ((item.fieldType ?? 'brown_field') !== 'green_field') return item;

  const existingDivision = item.division as GFDivision | undefined;
  const oldHead = item.head;

  if (
    !isStaleGreenFieldHead(oldHead) &&
    existingDivision &&
    getDivisionForHead(oldHead) === existingDivision
  ) {
    return withGreenFieldProjectType(item);
  }

  if (!isStaleGreenFieldHead(oldHead) && !existingDivision && getDivisionForHead(oldHead)) {
    return withGreenFieldProjectType({ ...item, division: getDivisionForHead(oldHead), head: oldHead });
  }

  if (LAND_BUILDING_HEADS.has(oldHead)) {
    return withGreenFieldProjectType({ ...item, division: 'Land & Building', head: oldHead });
  }
  if (MACHINERY_HEADS.has(oldHead)) {
    return withGreenFieldProjectType({ ...item, division: 'Machinery', head: oldHead });
  }
  if (UTILITIES_HEADS.has(oldHead)) {
    return withGreenFieldProjectType({ ...item, division: 'Utilities', head: oldHead });
  }

  if (oldHead === 'Machinery') {
    return withGreenFieldProjectType({
      ...item,
      division: 'Machinery',
      head: mapMachineryDepartment(item.department, item.subParticulars),
    });
  }

  if (oldHead === 'Utilities') {
    const mapped = mapUtilitiesDepartment(item.department, item.subParticulars);
    return withGreenFieldProjectType({ ...item, division: mapped.division, head: mapped.head });
  }

  if (oldHead === 'Misc.') {
    const mapped = mapMiscItem(item.subParticulars);
    return withGreenFieldProjectType({ ...item, division: mapped.division, head: mapped.head });
  }

  const inferred = getDivisionForHead(oldHead);
  if (inferred) return withGreenFieldProjectType({ ...item, division: inferred });

  return withGreenFieldProjectType(item);
}

const BROWN_MACHINERY_SUB_HEADS = new Set(GF_DIVISION_HEADS.Machinery);
const BROWN_UTILITIES_SUB_HEADS = new Set(GF_DIVISION_HEADS.Utilities);

/** Resolve Brown Field main group from a flat legacy head name. */
export function getBrownFieldDivisionForHead(head: string): BrownFieldDivision {
  if (head === 'Machinery' || BROWN_MACHINERY_SUB_HEADS.has(head)) return 'Machinery';
  if (head === 'Utilities' || BROWN_UTILITIES_SUB_HEADS.has(head)) return 'Utilities';
  if (head === 'Legal') return 'Legal';
  return 'Other Brown Field';
}

function mapBrownFieldMachineryHead(department: string, subParticulars: string): string {
  return mapMachineryDepartment(department, subParticulars);
}

function mapBrownFieldUtilitiesHead(
  department: string,
  subParticulars: string,
): string {
  return mapUtilitiesDepartment(department, subParticulars).head;
}

/** Migrate legacy Brown Field master rows to division + sub-head structure. */
export function migrateBrownFieldMasterItem(item: CapexMasterItem): CapexMasterItem {
  if ((item.fieldType ?? 'brown_field') !== 'brown_field') return item;

  const withType = withProjectType(item);

  const existingDivision = withType.division as BrownFieldDivision | undefined;
  const oldHead = withType.head;

  if (existingDivision === 'Machinery' && BROWN_MACHINERY_SUB_HEADS.has(oldHead)) {
    return withType;
  }
  if (existingDivision === 'Utilities' && BROWN_UTILITIES_SUB_HEADS.has(oldHead)) {
    return withType;
  }
  if (existingDivision === 'Legal') {
    return withType;
  }
  if (existingDivision === 'Other Brown Field' && BROWN_FIELD_OTHER_HEADS.includes(oldHead)) {
    return withType;
  }

  if (oldHead === 'Machinery') {
    return {
      ...withType,
      division: 'Machinery',
      head: mapBrownFieldMachineryHead(withType.department, withType.subParticulars),
    };
  }

  if (oldHead === 'Utilities') {
    return {
      ...withType,
      division: 'Utilities',
      head: mapBrownFieldUtilitiesHead(withType.department, withType.subParticulars),
    };
  }

  if (oldHead === 'Legal') {
    return { ...withType, division: 'Legal', head: oldHead };
  }

  if (BROWN_MACHINERY_SUB_HEADS.has(oldHead)) {
    return { ...withType, division: 'Machinery', head: oldHead };
  }
  if (BROWN_UTILITIES_SUB_HEADS.has(oldHead)) {
    return { ...withType, division: 'Utilities', head: oldHead };
  }

  return { ...withType, division: 'Other Brown Field', head: oldHead };
}

/** Migrate all Brown Field rows from flat buckets to division + child-head structure. */
export function migrateBrownFieldToNestedDivisions(items: CapexMasterItem[]): CapexMasterItem[] {
  return items.map(item => migrateBrownFieldMasterItem(item));
}

/** Normalize Digitisation / IT master rows. */
export function migrateSpecialFieldMasterItem(item: CapexMasterItem): CapexMasterItem {
  const fieldType = item.fieldType ?? 'brown_field';
  if (fieldType === 'digitisation') {
    return { ...item, division: item.division ?? 'Digitisation', fieldType: 'digitisation' };
  }
  if (fieldType === 'information_technology') {
    return {
      ...item,
      division: item.division ?? 'Information Technology',
      fieldType: 'information_technology',
    };
  }
  return item;
}

/** Move Brown Field Digitization rows to Digitisation master (one-time). */
export function migrateDigitisationMasterItems(items: CapexMasterItem[]): CapexMasterItem[] {
  return items.map(item => {
    if ((item.fieldType ?? 'brown_field') !== 'brown_field') return item;
    if (item.head !== 'Digitization') return item;
    return {
      ...item,
      fieldType: 'digitisation',
      division: 'Digitisation',
      head: 'Digitization',
    };
  });
}

/** Normalize master item division for either field type. */
export function normalizeMasterItemDivision(item: CapexMasterItem): CapexMasterItem {
  const fieldType = item.fieldType ?? 'brown_field';
  if (fieldType === 'green_field') {
    return migrateGreenFieldToSections([item])[0];
  }
  if (fieldType === 'digitisation' || fieldType === 'information_technology') {
    return migrateSpecialFieldMasterItem(item);
  }
  return migrateBrownFieldMasterItem(item);
}

/** Apply migration: Brown Field flat + Green Field sections. */
export function finalizeMockCapexMaster(items: CapexMasterItem[]): CapexMasterItem[] {
  const normalized = items.map(item => {
    const fieldType = item.fieldType ?? 'brown_field';
    if (fieldType === 'green_field') return item;
    return normalizeMasterItemDivision(item);
  });
  const withGreenSections = migrateGreenFieldToSections(normalized);
  return migrateToFlatMaster(withGreenSections);
}

export function getMasterBackfillKey(item: CapexMasterItem): string {
  const normalized = normalizeMasterItemDivision(item);
  const divisionPart = normalized.division ? `|${normalized.division}` : '';
  const projectTypePart =
    isProjectTypeScopedField(normalized.fieldType ?? 'brown_field')
      ? `|${resolveProjectType(normalized)}`
      : '';
  return `${normalized.fieldType ?? 'brown_field'}|${normalized.fy}|${normalized.plant}${projectTypePart}${divisionPart}|${normalized.head}|${normalized.department}|${normalized.subParticulars}`;
}

export interface HeadBudgetSummary {
  head: string;
  totalCr: number;
  count: number;
}

/** Aggregate planned budget (Cr) and line count per budget head. */
export function getHeadBudgetSummaries(items: CapexMasterItem[]): HeadBudgetSummary[] {
  const map = new Map<string, HeadBudgetSummary>();
  for (const item of items) {
    const head = item.head || 'Other';
    const cur = map.get(head) ?? { head, totalCr: 0, count: 0 };
    cur.totalCr += item.totalCost;
    cur.count += 1;
    map.set(head, cur);
  }
  return [...map.values()].sort((a, b) => b.totalCr - a.totalCr);
}

// ── Green Field budget hierarchy helpers ─────────────────────────────────────

export function greenFieldPlantBudgetKey(
  plant: string,
  fy: string,
  projectType: ProjectType,
): string {
  return `${plant}|${fy}|${projectType}`;
}

export function greenFieldHeadBudgetKey(
  plant: string,
  fy: string,
  projectType: ProjectType,
  division: string,
  head: string,
): string {
  return `${plant}|${fy}|${projectType}|${division}|${head}`;
}

export function greenFieldSectionBudgetKey(
  plant: string,
  fy: string,
  projectType: ProjectType,
  division: string,
): string {
  return `${plant}|${fy}|${projectType}|${division}`;
}

export function getGreenFieldPlantBudgetCr(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
): number | undefined {
  const match = allocations.plantBudgets.find(
    (b) => b.plant === plant && b.fy === fy && b.projectType === projectType,
  );
  return match?.budgetCr;
}

export function getGreenFieldSectionBudgetCr(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
  division: string,
): number | undefined {
  const match = allocations.sectionBudgets.find(
    (b) =>
      b.plant === plant &&
      b.fy === fy &&
      b.projectType === projectType &&
      b.division === division,
  );
  return match?.budgetCr;
}

export function getGreenFieldHeadBudgetCr(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
  division: string,
  head: string,
): number | undefined {
  const match = allocations.headBudgets.find(
    (b) =>
      b.plant === plant &&
      b.fy === fy &&
      b.projectType === projectType &&
      b.division === division &&
      b.head === head,
  );
  return match?.budgetCr;
}

export function sumGreenFieldHeadBudgetsForPlant(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
): number {
  return allocations.headBudgets
    .filter((b) => b.plant === plant && b.fy === fy && b.projectType === projectType)
    .reduce((s, b) => s + b.budgetCr, 0);
}

export function sumGreenFieldSectionBudgetsForPlant(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
): number {
  return allocations.sectionBudgets
    .filter((b) => b.plant === plant && b.fy === fy && b.projectType === projectType)
    .reduce((s, b) => s + b.budgetCr, 0);
}

export function sumGreenFieldHeadBudgetsForSection(
  allocations: GreenFieldBudgetAllocations,
  plant: string,
  fy: string,
  projectType: ProjectType,
  division: string,
): number {
  return allocations.headBudgets
    .filter(
      (b) =>
        b.plant === plant &&
        b.fy === fy &&
        b.projectType === projectType &&
        b.division === division,
    )
    .reduce((s, b) => s + b.budgetCr, 0);
}

export interface GreenFieldBudgetStatus {
  allocatedCr: number;
  usedCr: number;
  remainingCr: number;
  over: boolean;
  hasAllocation: boolean;
}

export function greenFieldBudgetStatus(
  allocatedCr: number | undefined,
  usedCr: number,
): GreenFieldBudgetStatus {
  const hasAllocation = allocatedCr != null && allocatedCr > 0;
  const allocated = allocatedCr ?? 0;
  const remainingCr = allocated - usedCr;
  return {
    allocatedCr: allocated,
    usedCr,
    remainingCr,
    over: hasAllocation && usedCr > allocated,
    hasAllocation,
  };
}
