export const STATE_BUCKETS = ['success', 'failed', 'warning', 'running', 'info', 'neutral', 'pending'] as const;
export type StateBucket = typeof STATE_BUCKETS[number];

const STATES: Readonly<Record<string, StateBucket>> = Object.freeze({
    SUCCESS: 'success',
    FAILED: 'failed', KILLED: 'failed',
    WARNING: 'warning', PAUSED: 'warning', RETRYING: 'warning',
    RUNNING: 'running', BREAKPOINT: 'running',
    CREATED: 'info', RESTARTED: 'info', RETRIED: 'info', SUBMITTED: 'info',
    CANCELLED: 'neutral', SKIPPED: 'neutral', QUEUED: 'neutral',
    KILLING: 'pending'
});

export function stateBucket(state: string | undefined): StateBucket | '' {
    const s = (state || '').toUpperCase();
    if (!s) {
        return '';
    }
    return STATES[s] ?? 'neutral';
}

export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const;

const LOG_LEVEL_RANK: Readonly<Record<string, number>> = Object.freeze(
    Object.fromEntries([...LOG_LEVELS].reverse().map((level, index) => [level, index]))
);

export function logLevelRank(level: string | undefined): number {
    return LOG_LEVEL_RANK[(level || '').toUpperCase()] ?? 0;
}
