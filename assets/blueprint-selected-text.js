// Generated from src/services/selected-project-text.ts. Do not hand edit.
/** Local-only, bounded extraction of labelled details chosen by the user.
 * No provider, storage or network access. Source text is never an instruction.
 */
export const MAX_SELECTED_TEXT = 20000;
const fields = {
    name: { label: 'Project name', limit: 200 }, businessName: { label: 'Business name', limit: 160 },
    location: { label: 'Location', limit: 300 }, objective: { label: 'Intended outcome', limit: 2000 },
    targetDate: { label: 'Target date', limit: 10 },
};
const aliases = {
    project: 'name', 'project name': 'name', job: 'name', 'job name': 'name',
    business: 'businessName', 'business name': 'businessName', company: 'businessName',
    site: 'location', 'site address': 'location', address: 'location', location: 'location',
    scope: 'objective', objective: 'objective', outcome: 'objective', 'intended outcome': 'objective',
    target: 'targetDate', 'target date': 'targetDate', 'completion date': 'targetDate',
};
const normalise = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const safeDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1900 || year > 2199)
        return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
export function reviewSelectedProjectText(input) {
    const result = (state, message) => ({ state, message, suggestions: [], warnings: [] });
    if (typeof input !== 'string' || !input.trim())
        return result('empty', 'Paste the project details you want to use.');
    if (input.length > MAX_SELECTED_TEXT)
        return result('too-long', 'Select a shorter extract, up to 20,000 characters. Nothing has been uploaded.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))
        return result('unrecognised', 'Use readable text rather than a file or encoded attachment.');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passcode|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|bank account|account number|bsb|iban|credit card|tax file number)\s*[:=]\s*\S/i.test(input)) {
        return result('sensitive', 'Remove passwords, account details or other private information, then try again. Nothing has been uploaded.');
    }
    const found = new Map();
    const conflicts = new Set();
    const warnings = new Set();
    const lines = input.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((raw, index) => {
        const match = /^\s*([A-Za-z ]{2,30})\s*:\s*(.+?)\s*$/.exec(raw);
        if (!match)
            return;
        const label = normalise(match[1]).toLowerCase();
        if (!Object.hasOwn(aliases, label))
            return;
        const key = aliases[label];
        const value = normalise(match[2]).replace(/[\u202a-\u202e\u2066-\u2069]/g, '');
        if (!value)
            return;
        if (value.length > fields[key].limit) {
            warnings.add(`${fields[key].label} is too long. Add a shorter version in the draft.`);
            return;
        }
        if (key === 'targetDate' && !safeDate(value)) {
            warnings.add('Check the target date in the draft. Use YYYY-MM-DD; ambiguous dates are not guessed.');
            return;
        }
        const previous = found.get(key);
        if (previous && previous.value.toLowerCase() !== value.toLowerCase()) {
            conflicts.add(key);
            return;
        }
        if (!previous)
            found.set(key, { key, label: fields[key].label, value, sourceLine: index + 1 });
    });
    if (conflicts.size)
        return result('ambiguous', 'Conflicting project details were found. Paste an extract for one project, or enter a private brief manually.');
    if (!found.size)
        return result('unrecognised', 'No clear project fields were found. Try lines such as Project:, Location: or Scope:, or create a brief manually.');
    if (!found.has('name'))
        warnings.add('Add a project name before saving the draft.');
    if (!found.has('objective'))
        warnings.add('Describe the intended outcome before saving the draft.');
    return { state: 'review', message: 'Check each suggestion before using it. The original text is not uploaded.',
        suggestions: [...found.values()], warnings: [...warnings] };
}
/** Copy only explicitly selected fields. Never attach the source text or invent IDs. */
export function selectedIntakeFields(review, selected) {
    if (review.state !== 'review')
        return {};
    const output = {};
    for (const suggestion of review.suggestions) {
        if (Object.hasOwn(fields, suggestion.key) && selected.includes(suggestion.key))
            output[suggestion.key] = suggestion.value;
    }
    return output;
}
