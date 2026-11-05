// Shared StratOps aircraft trainer exclusion rules.
// Used by both browser ES modules and Node.js workers to prevent filtering drift.
// Special operational aircraft retain their existing exception unless training activity is explicit.

export const TRAINING_ACTIVITY_PATTERNS = [
    /\btrainer\b/i,
    /\bbasic trainer\b/i,
    /\bprimary trainer\b/i,
    /\badvanced trainer\b/i,
    /\bjet trainer\b/i,
    /\bflight training\b/i,
    /\bpilot training\b/i,
    /\btraining aircraft\b/i,
    /\btraining (flight|activity|mission|sortie)\b/i,
    /\bmilitary training aircraft\b/i,
];

export const TRAINER_SPECIAL_OPERATIONAL_PATTERNS = [
    /\bFA-?50\b/i,
    /\bYAK(?:OVLEV)?[-\s]?130\b/i,
    /\bM-?346FA\b/i,
    /\bA-?29\b/i,
    /\bSUPER TUCANO\b/i,
    /\bAT-?6\b/i,
    /\bWOLVERINE\b/i,
    /\bBLACK ?HAWK\b/i,
    /\bSEAHAWK\b/i,
    /\bHAWKEYE\b/i,
];

export const TRAINER_PLATFORM_PATTERNS = [
    /\bT[-\s]?44A?\b/i,
    /\bC[-\s]?12V\b/i,
    /\bF[-\s]?5N\b/i,
    /\bT[-\s]?41(?:[A-D])?\b/i,
    /\bMESCALERO\b/i,
    /\bDG[-\s]?1000S?\b/i,
    /\bTG[-\s]?16A\b/i,
    /\b(?:AERO\s+)?L-?(?:29|39|59)\b/i,
    /\bDELFIN\b/i,
    /\bALBATROS\b/i,
    /\bSUPER ALBATROS\b/i,
    /\bALPHA JET\b/i,
    /\b(?:BAE\s+)?HAWK(?:\s+(?:T[12]|100|200))?\b/i,
    /(^|[^A-Z0-9])T-?6[ABC]?\b/i,
    /\bTEXAN II\b/i,
    /\bBEECHCRAFT\s+T-?6\b/i,
    /\bCT-?156\b/i,
    /\bHARVARD II\b/i,
    /\b(?:PILATUS\s+)?PC-?(?:7|9|21)(?:\s*(?:MKII|M))?\b/i,
    /\bGROB\s+G-?(?:115|120A?|120TP)\b/i,
    /\bG-?(?:115|120A?|120TP)\b/i,
    /\bCIRRUS\s+T-?53A?\b/i,
    /\bCIRRUS\s+SR-?20\b/i,
    /(^|[^A-Z0-9])T-?53A?\b/i,
    /\bKAYDET\s+II\b/i,
    /\bSHARK\s*\d+\b/i,
    /(^|[^A-Z0-9])T-?38[AC]?\b/i,
    /\bTALON\b/i,
    /\b(?:BOEING\s+)?T-?7A?\b/i,
    /\bRED HAWK\b/i,
    /\b(?:KAI\s+)?KT-?1\b/i,
    /\bWOONGBI\b/i,
    /\b(?:HONGDU\s+|NANCHANG\s+)?CJ-?6\b/i,
    /\bYAK(?:OVLEV)?[-\s]?(?:52|152)\b/i,
    /\bPZL-?130\b/i,
    /\bORLIK\b/i,
    /\bSF-?260(?:EA)?\b/i,
    /\bDIAMOND\s+DA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bDA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bEMB-?312\b/i,
    /\bTUCANO\b/i,
    /\bK-?8\b/i,
    /\bJL-?8\b/i,
    /\bKARAKORUM\b/i,
    /\bM-?311\b/i,
    /\bM-?345\b/i,
    /\bM-?346(?!FA)\b/i,
    /\bMB-?(?:326|339)\b/i,
    /\bJET PROVOST\b/i,
    /\bSCOTTISH AVIATION BULLDOG\b/i,
    /\bBULLDOG\b/i,
    /\bCT-?114\b/i,
    /\bTUTOR\b/i,
    /\bJL-?10\b/i,
    /\bL-?15\b/i,
];

export function isExcludedTrainerAircraftText(text = "") {
    const haystack = String(text || "");
    if (!haystack) return false;
    const hasTrainingActivity = TRAINING_ACTIVITY_PATTERNS.some((pattern) => pattern.test(haystack));
    if (!hasTrainingActivity && TRAINER_SPECIAL_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(haystack))) {
        return false;
    }
    return hasTrainingActivity || TRAINER_PLATFORM_PATTERNS.some((pattern) => pattern.test(haystack));
}
