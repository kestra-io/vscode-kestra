export type StateBucket = 'success' | 'failed' | 'warning' | 'running' | 'info' | 'neutral' | 'pending';

const STATES: Readonly<Record<string, StateBucket>> = Object.freeze({
    SUCCESS: 'success',
    FAILED: 'failed', KILLED: 'failed',
    WARNING: 'warning', PAUSED: 'warning', RETRYING: 'warning',
    RUNNING: 'running', BREAKPOINT: 'running',
    CREATED: 'info', RESTARTED: 'info', RETRIED: 'info', SUBMITTED: 'info',
    CANCELLED: 'neutral', SKIPPED: 'neutral', QUEUED: 'neutral',
    KILLING: 'pending'
});

const BUCKET_SYMBOL: Readonly<Record<StateBucket, string>> = Object.freeze({
    success: '✓', failed: '✗', warning: '⚠', running: '▶', info: '•', neutral: '•', pending: '•'
});

export function stateBucket(state: string | undefined): StateBucket | '' {
    const s = (state || '').toUpperCase();
    if (!s) {
        return '';
    }
    return STATES[s] ?? 'neutral';
}

export function stateSymbol(state: string | undefined): string {
    const bucket = stateBucket(state);
    return bucket ? BUCKET_SYMBOL[bucket] : '•';
}

export const LOG_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as const;

const LOG_LEVEL_RANK: Readonly<Record<string, number>> = Object.freeze(
    Object.fromEntries([...LOG_LEVELS].reverse().map((level, index) => [level, index]))
);

export function logLevelRank(level: string | undefined): number {
    return LOG_LEVEL_RANK[(level || '').toUpperCase()] ?? 0;
}
