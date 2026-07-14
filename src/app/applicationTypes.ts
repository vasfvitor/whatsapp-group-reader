export type RunOperation = <T>(operation: () => Promise<T>) => Promise<T | null>
