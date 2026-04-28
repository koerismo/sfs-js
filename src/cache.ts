type IndexedCallback<T> = (index: T) => void;
export type CacheConstructorReturn<T> = { onActivity: IndexedCallback<T>; dispose: () => void };
export type CacheConstructor<Out, In = Out> = (onInactive: IndexedCallback<Out>) => CacheConstructorReturn<In>;

export const makeExpoCache: CacheConstructor<number> = function(onInactive) {
	const THRESHOLD = 0.5;
	const INTERVAL = 0.5; // Minutes
	const DECAY = 0.4 ** INTERVAL;

	const activityMap: Record<PropertyKey, number> = {};
	const timer = setInterval(() => {
		for (const idx in activityMap) {
			const v = activityMap[idx] * DECAY;
			if (v < THRESHOLD) {
				delete activityMap[idx];
				onInactive(+idx);
			} else {
				activityMap[idx] = v;
			}
		}
	}, 60_000 * INTERVAL);

	// For node: Allow the main process to quit even if
	// this loop is still running.
	if (typeof timer === 'object' && 'unref' in timer)
		timer.unref();

	return {
		onActivity(key) {
			activityMap[key] = Math.min((activityMap[key] ?? 0) + 1.0, 100.0);
		},
		dispose() {
			clearInterval(timer);
			if (typeof timer === 'object' && 'close' in timer)
				timer.close();
		},
	};
}
