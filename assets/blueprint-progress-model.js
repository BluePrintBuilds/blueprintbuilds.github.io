// Generated from src/services/build-progress.ts; verified by the progress tests.
/** A percentage describes recorded progress, never acceptance or handover. */
export function buildProgress(input) {
    const hasCounts = input.completed !== undefined || input.total !== undefined;
    const countsValid = Number.isSafeInteger(input.completed) && Number.isSafeInteger(input.total)
        && input.completed >= 0 && input.total >= 0 && input.completed <= input.total;
    const total = countsValid ? input.total : null;
    const completed = countsValid ? input.completed : null;
    const percentageValid = typeof input.percentage === 'number' && Number.isFinite(input.percentage)
        && input.percentage >= 0 && input.percentage <= 100;
    const value = hasCounts ? countsValid && total > 0 ? 100 * completed / total : null
        : percentageValid ? input.percentage : null;
    const complete = value === 100;
    const display = value === null ? '—' : value > 0 && value < 1 ? '<1%'
        : `${complete ? 100 : Math.min(99, Math.round(value))}%`;
    const summary = total === 0 ? 'No stages set yet' : total !== null && value !== null
        ? `${completed} of ${total} stages complete` : value === null ? 'Progress not available'
        : 'Recorded build progress';
    return { value, display, summary, complete, completed, total,
        remaining: total !== null ? total - completed : null,
        completionText: complete ? total !== null ? 'Stages complete. Handover is checked separately.' : 'Recorded progress is 100%. Handover is checked separately.' : null,
        accessibleText: value === null ? summary : `${display} · ${summary}${complete ? '. Handover is checked separately.' : ''}` };
}
